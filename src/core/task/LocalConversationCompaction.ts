import { type ApiHandler, buildApiHandlerForSelection } from "@core/api"
import { ActiveModelTextCondenser } from "@core/text-condensation/ActiveModelTextCondenser"
import type { ContextManager } from "@core/context/context-management/ContextManager"
import { getTaskHookModelContext } from "./runtime/TaskRuntimeModelContext"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import { executePreCompactHookWithCleanup, HookCancellationError } from "@core/hooks/precompact-executor"
import { continuationPrompt } from "@core/prompts/contextManagement"
import type { TaskWorkingConfiguration } from "./runtime/TaskWorkingConfiguration"
import { ConversationCondensationService } from "@core/text-condensation/ConversationCondensationService"
import {
	CONVERSATION_CONTINUATION_TEMPLATE_ID,
	createDefaultTextCondensationTemplateRegistry,
} from "@core/text-condensation/templates"
import { UtilityModelTextCondenser } from "@core/text-condensation/UtilityModelTextCondenser"
import {
	getConfiguredUtilityModelSelection,
	isUtilityTextCondensationAvailable,
} from "@core/text-condensation/UtilityTextCondensationAvailability"
import { UtilityModelCancelledError, UtilityModelRunner } from "@core/utility-model/UtilityModelRunner"
import type { ApiConfiguration, ModelProviderSelection } from "@shared/api"
import { CardStatus, ICardHandle } from "@shared/ExtensionMessage"
import { DiracIcon } from "@shared/icons"
import { Logger } from "@shared/services/Logger"
import { stripHashes } from "@shared/utils/line-hashing"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { getErrorMessage } from "@/shared/errors"
import type { MessageStateHandler } from "./message-state"
import type { TaskMessenger } from "./TaskMessenger"
import type { TaskState } from "./TaskState"
import { recordUtilityModelUsage } from "./recordUtilityModelUsage"
import type { HookExecution } from "./types/HookExecution"

export type LocalConversationCompactionSource = "automatic" | "user"

/**
 * Outcome of a condensation attempt. Only `completed` changes conversation
 * state; every other status leaves the conversation untouched.
 */
export type LocalConversationCompactionOutcome =
	| { status: "completed"; continuation: string }
	| { status: "unavailable" }
	| { status: "cancelled" }
	| { status: "failed" }

const CONDENSE_APPROVAL_HEADER = "Condense Conversation"
const CONDENSE_APPROVAL_BODY =
	"Condense this conversation? The earlier turns are replaced by a summary, which is shown on this card afterwards."
const CONDENSE_CANCELLED_BODY = "Conversation condensation cancelled. The conversation was not compacted."

interface LocalConversationCompactionDependencies {
	taskId: string
	ulid: string
	taskState: TaskState
	messageStateHandler: MessageStateHandler
	contextManager: ContextManager
	getWorkingConfiguration: () => TaskWorkingConfiguration
	taskMessenger: TaskMessenger
	getApi: () => ApiHandler
	createActiveModelHandler?: () => ApiHandler
	getCurrentProviderId?: () => string | undefined
	getCurrentMode?: () => string
	postStateToWebview: () => Promise<void>
	cancelTask: () => Promise<void>
	setActiveHookExecution: (hookExecution: HookExecution | undefined) => Promise<void>
	clearActiveHookExecution: () => Promise<void>
	onContextCompacted?: () => void
}

export interface LocalConversationCompactionOptions {
	source: LocalConversationCompactionSource
	triggerApiRequestIndex?: number
	/** Explicit /smol already expresses intent; skip the redundant approval card. */
	skipApproval?: boolean
}

interface CondensationModelIdentity {
	providerId: string
	modelId: string
	fallback: boolean
}

/**
 * Runs conversation condensation outside the active model/tool loop. The Utility
 * model is preferred; the active model is used only as an explicit
 * user-requested fallback when no Utility model is configured.
 */
export class LocalConversationCompaction {
	constructor(private readonly dependencies: LocalConversationCompactionDependencies) {}

	isAvailable(): boolean {
		return isUtilityTextCondensationAvailable(
			{
				utilityModelEnabled: this.dependencies.getWorkingConfiguration().settings.utilityModelEnabled,
				utilityModelUseCondense: this.dependencies.getWorkingConfiguration().settings.utilityModelUseCondense,
				utilityModelUseNewTask: this.dependencies.getWorkingConfiguration().settings.utilityModelUseNewTask,
				utilityModelSelection: this.dependencies.getWorkingConfiguration().settings.utilityModelSelection,
			},
			CONVERSATION_CONTINUATION_TEMPLATE_ID,
			createDefaultTextCondensationTemplateRegistry(),
		)
	}

	async run(options: LocalConversationCompactionOptions): Promise<LocalConversationCompactionOutcome> {
		const templates = createDefaultTextCondensationTemplateRegistry()
		const settings = {
			utilityModelEnabled: this.dependencies.getWorkingConfiguration().settings.utilityModelEnabled,
			utilityModelUseCondense: this.dependencies.getWorkingConfiguration().settings.utilityModelUseCondense,
			utilityModelUseNewTask: this.dependencies.getWorkingConfiguration().settings.utilityModelUseNewTask,
			utilityModelSelection: this.dependencies.getWorkingConfiguration().settings.utilityModelSelection,
		}
		const selection = getConfiguredUtilityModelSelection(settings.utilityModelSelection)
		const configuredIdentity = this.getConfiguredIdentity(settings.utilityModelSelection)

		const utilityAvailable = Boolean(selection) && this.isAvailable()
		const useFallback = !utilityAvailable
		if (useFallback && options.source !== "user") return { status: "unavailable" }
		if (useFallback && !templates.has(CONVERSATION_CONTINUATION_TEMPLATE_ID)) return { status: "unavailable" }

		const approval = await this.requestUserApproval(options.source, options.skipApproval)
		if (approval.outcome === "declined") return { status: "cancelled" }

		let handler: ApiHandler
		let identity: CondensationModelIdentity
		try {
			if (useFallback) {
				handler = this.dependencies.createActiveModelHandler?.() ?? this.dependencies.getApi()
				identity = {
					providerId: this.dependencies.getCurrentProviderId?.() ?? "active-model",
					modelId: handler.getModel().id,
					fallback: true,
				}
			} else {
				handler = buildApiHandlerForSelection(
					structuredClone(this.dependencies.getWorkingConfiguration().apiConfiguration) as ApiConfiguration,
					selection!,
					{
						ulid: this.dependencies.ulid,
					},
				)
				identity = {
					providerId: selection!.provider,
					modelId: handler.getModel().id,
					fallback: false,
				}
			}
		} catch (error) {
			await this.displayFailure(useFallback ? undefined : configuredIdentity, error, approval.card, useFallback)
			return { status: "failed" }
		}

		const card = approval.card
			? await this.reuseApprovalCard(approval.card, identity)
			: await this.createCondensingCard(identity)

		let summary: string
		let continuation: string
		try {
			summary = await this.generateSummary(selection, handler, templates, useFallback, this.linkedCondensationSignal(useFallback ? handler : undefined))
			this.throwIfCancelled()
			const range = this.dependencies.contextManager.getNextTruncationRange(
				this.dependencies.messageStateHandler.getApiConversationHistory(),
				this.dependencies.taskState.conversationHistoryDeletedRange,
				"lastTwo",
			)
			const contextModification = await this.runPreCompactHook(options.source, range)
			this.throwIfCancelled()

			continuation = continuationPrompt(summary)
			if (contextModification) {
				continuation += `\n\n[Context Modification from PreCompact Hook]\n${contextModification}`
			}

			await this.applyCompaction(range, options.triggerApiRequestIndex)
		} catch (error) {
			const cancelled =
				this.dependencies.taskState.abort ||
				error instanceof UtilityModelCancelledError ||
				error instanceof HookCancellationError
			const status = cancelled ? CardStatus.CANCELLED : CardStatus.ERROR
			const state = cancelled ? "Cancelled" : "Failed"
			await card.update({
				header: `Conversation Condensation ${state} · ${this.formatIdentity(identity)}`,
				status,
				body: cancelled ? CONDENSE_CANCELLED_BODY : this.buildFailureBody(error, identity.fallback),
				collapsed: false,
			})
			await card.finalize(status, true)
			if (!cancelled) Logger.error("Local conversation condensation failed", error)
			return { status: cancelled ? "cancelled" : "failed" }
		}

		try {
			await card.update({
				header: `Conversation Condensed · ${this.formatIdentity(identity)}`,
				status: CardStatus.SUCCESS,
				body: stripHashes(summary),
				renderType: "markdown",
				collapsed: true,
			})
			await card.finalize(CardStatus.SUCCESS)
		} catch (error) {
			Logger.error("Failed to present completed local conversation condensation", error)
		}

		try {
			this.dependencies.onContextCompacted?.()
		} catch (error) {
			Logger.error("Local conversation compaction observer failed", error)
		}

		return { status: "completed", continuation }
	}

	/**
	 * Asks the user before a user-requested condensation. Automatic condensation,
	 * explicit direct actions, and fully autonomous sessions skip the prompt and
	 * get a progress card instead.
	 */
	private async requestUserApproval(
		source: LocalConversationCompactionSource,
		skipApproval = false,
	): Promise<{ outcome: "approved" | "declined" | "skipped"; card?: ICardHandle }> {
		if (source !== "user") return { outcome: "skipped" }
		if (skipApproval) return { outcome: "skipped" }
		if (this.dependencies.stateManager.getGlobalSettingsKey("yoloModeToggled")) return { outcome: "skipped" }

		const card = await this.dependencies.taskMessenger.createCard({
			header: CONDENSE_APPROVAL_HEADER,
			icon: DiracIcon.CHAT,
			requireApproval: true,
			collapsed: false,
			renderType: "markdown",
			body: CONDENSE_APPROVAL_BODY,
			actions: [
				{ label: "Condense", value: DiracAskResponse.APPROVE, primary: true },
				{ label: "Cancel", value: DiracAskResponse.REJECT, style: "secondary" },
			],
		})

		const interaction = await card.waitForInteraction()
		if (interaction.action === DiracAskResponse.APPROVE) return { outcome: "approved", card }

		await card.update({ body: CONDENSE_CANCELLED_BODY })
		await card.finalize(CardStatus.CANCELLED)
		return { outcome: "declined" }
	}

	/** Reuses the approval card as the progress and result card. */
	private async reuseApprovalCard(card: ICardHandle, identity: CondensationModelIdentity): Promise<ICardHandle> {
		await card.update({
			header: `Condensing Conversation · ${this.formatIdentity(identity)}`,
			status: CardStatus.RUNNING,
			body: "",
		})
		return card
	}

	private async createCondensingCard(identity: CondensationModelIdentity): Promise<ICardHandle> {
		return await this.dependencies.taskMessenger.createCard({
			header: `Condensing Conversation · ${this.formatIdentity(identity)}`,
			status: CardStatus.RUNNING,
			icon: DiracIcon.SUMMARIZE,
			collapsed: false,
		})
	}

	private linkedCondensationSignal(disposableHandler?: ApiHandler): AbortSignal | undefined {
		const parent = this.dependencies.taskState.abortSignal
		if (parent.aborted) return parent
		if (!disposableHandler) return parent
		const controller = new AbortController()
		const onAbort = () => {
			try { disposableHandler.abort?.() } catch { /* best effort */ }
			controller.abort()
		}
		parent.addEventListener("abort", onAbort, { once: true })
		return controller.signal
	}

	private throwIfCancelled(): void {
		if (this.dependencies.taskState.abort) throw new UtilityModelCancelledError()
	}

	private async generateSummary(
		selection: ModelProviderSelection | undefined,
		handler: ApiHandler,
		templates: ReturnType<typeof createDefaultTextCondensationTemplateRegistry>,
		useFallback: boolean,
		signal?: AbortSignal,
	): Promise<string> {
		const textCondenser = useFallback
			? new ActiveModelTextCondenser(handler, templates)
			: new UtilityModelTextCondenser(
					new UtilityModelRunner(selection!, () => handler, {
						onUsage: (event) => recordUtilityModelUsage(this.dependencies.taskState, this.dependencies.ulid, event),
					}),
					templates,
				)
		const service = new ConversationCondensationService({
			messageState: this.dependencies.messageStateHandler,
			contextManager: this.dependencies.contextManager,
			getConversationHistoryDeletedRange: () => this.dependencies.taskState.conversationHistoryDeletedRange,
			textCondenser,
		})
		return await service.condenseConversation(CONVERSATION_CONTINUATION_TEMPLATE_ID, {
			historyScope: "effective",
			signal: signal,
		})
	}

	private async runPreCompactHook(
		source: LocalConversationCompactionSource,
		range: [number, number],
	): Promise<string | undefined> {
		const hooksEnabled = getHooksEnabledSafe(this.dependencies.getWorkingConfiguration().settings.hooksEnabled)
		if (!hooksEnabled) return undefined

		const result = await executePreCompactHookWithCleanup({
			taskId: this.dependencies.taskId,
			ulid: this.dependencies.ulid,
			modelContext: getTaskHookModelContext(this.dependencies.getApi(), this.dependencies.getWorkingConfiguration()),
			apiConversationHistory: this.dependencies.messageStateHandler.getApiConversationHistory(),
			conversationHistoryDeletedRange: this.dependencies.taskState.conversationHistoryDeletedRange,
			contextManager: this.dependencies.contextManager,
			diracMessages: this.dependencies.messageStateHandler.getDiracMessages(),
			messageStateHandler: this.dependencies.messageStateHandler,
			compactionStrategy: source === "automatic" ? "auto-condense" : "user-condense",
			deletedRange: range,
			messenger: this.dependencies.taskMessenger,
			setActiveHookExecution: this.dependencies.setActiveHookExecution,
			clearActiveHookExecution: this.dependencies.clearActiveHookExecution,
			postStateToWebview: this.dependencies.postStateToWebview,
			taskState: this.dependencies.taskState,
			cancelTask: this.dependencies.cancelTask,
			hooksEnabled,
			cancelTaskOnCancellation: false,
		})
		return result.contextModification
	}

	private async applyCompaction(range: [number, number], triggerApiRequestIndex?: number): Promise<void> {
		const previousRange = this.dependencies.taskState.conversationHistoryDeletedRange
		const previousSkip = this.dependencies.taskState.skipNextAutoCondenseCheck
		const previousPending = this.dependencies.taskState.pendingApiConversationCompaction
		const previousTrigger = this.dependencies.taskState.lastAutoCondenseTriggerIndex
		const previousProviderState = this.dependencies.messageStateHandler.getApiConversationProviderState()
		const pendingCompaction = {
			previousConversationHistoryDeletedRange: previousRange,
			conversationHistoryDeletedRange: range,
		}

		this.throwIfCancelled()
		try {
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState({
				...previousProviderState,
				pendingCompaction,
			})
			this.throwIfCancelled()

			this.dependencies.taskState.conversationHistoryDeletedRange = range
			this.dependencies.taskState.skipNextAutoCondenseCheck = true
			this.dependencies.taskState.pendingApiConversationCompaction = pendingCompaction
			if (triggerApiRequestIndex !== undefined) {
				this.dependencies.taskState.lastAutoCondenseTriggerIndex = triggerApiRequestIndex
			}
			await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
			this.throwIfCancelled()
		} catch (error) {
			this.dependencies.taskState.conversationHistoryDeletedRange = previousRange
			this.dependencies.taskState.skipNextAutoCondenseCheck = previousSkip
			this.dependencies.taskState.pendingApiConversationCompaction = previousPending
			this.dependencies.taskState.lastAutoCondenseTriggerIndex = previousTrigger
			await this.dependencies.messageStateHandler.overwriteApiConversationProviderState(previousProviderState)
			await this.dependencies.messageStateHandler.saveDiracMessagesAndUpdateHistory()
			throw error
		}
	}

	private async displayFailure(
		identity: CondensationModelIdentity | undefined,
		error: unknown,
		existingCard?: ICardHandle,
		useFallback = false,
	): Promise<void> {
		const header = `Conversation Condensation Failed · ${identity ? this.formatIdentity(identity) : useFallback ? "active model unavailable" : "Utility model unavailable"}`
		const body = this.buildFailureBody(error, useFallback)
		const card =
			existingCard ??
			(await this.dependencies.taskMessenger.createCard({
				header,
				status: CardStatus.ERROR,
				icon: DiracIcon.SUMMARIZE,
				body,
				collapsed: false,
			}))
		if (existingCard) await existingCard.update({ header, status: CardStatus.ERROR, body, collapsed: false })
		await card.finalize(CardStatus.ERROR, true)
		Logger.error("Failed to initialize conversation condensation", error)
	}

	private buildFailureBody(error: unknown, useFallback = false): string {
		const message = getErrorMessage(error)
		if (useFallback) return `Active-model conversation condensation failed. Retry, or configure a Utility model.\n\n${message}`
		return `Utility-model conversation condensation failed. Fix or change the configured Utility model, then retry.\n\n${message}`
	}

	private getConfiguredIdentity(selection: unknown): CondensationModelIdentity | undefined {
		if (!selection || typeof selection !== "object") return undefined
		const { provider, modelId } = selection as {
			provider?: unknown
			modelId?: unknown
		}
		if (typeof provider !== "string" || typeof modelId !== "string") return undefined
		return { providerId: provider, modelId, fallback: false }
	}

	private formatIdentity(identity: CondensationModelIdentity): string {
		const base = `${identity.providerId}/${identity.modelId}`
		return identity.fallback ? `${base} (active model)` : base
	}
}

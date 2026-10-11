import { formatResponse } from "@core/formatResponse"
import { buildTaskHandoffIntentSource, TASK_HANDOFF_TEMPLATE_ID } from "@core/text-condensation/templates"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { DiracIcon } from "@shared/icons"
import { telemetryService } from "@/services/telemetry"
import { CardStatus } from "@/shared/ExtensionMessage"
import { getErrorMessage } from "@/shared/errors"
import { DiracDefaultTool, DiracToolSpec } from "@/shared/tools"
import { IDiracTool } from "../../interfaces/IDiracTool"
import {
	type ConversationCondensationResult,
	ICardHandle,
	IToolEnvironment,
} from "../../interfaces/IToolEnvironment"

export const new_task_spec: DiracToolSpec = {
	id: DiracDefaultTool.NEW_TASK,
	name: "new_task",
	description: "Creates a replacement task with a standalone implementation handoff.",
	promptDescription: (context) =>
		context.taskHandoffCondensationAvailable === true
			? "Creates a replacement task from a concise intent. Provide only the desired objective and scope; a Utility model with access to the current task's conversation history will generate the complete standalone handoff for user preview."
			: "Creates a replacement task from a complete standalone implementation handoff that you generate. The replacement task will not have access to this conversation.",
	parameters: [
		{
			name: "context",
			required: true,
			contextRequirements: (context) => context.taskHandoffCondensationAvailable !== true,
			instruction:
				"Complete standalone implementation handoff for the replacement task. Include the objective, user intent, settled decisions, constraints, current state, findings, exact relevant files and symbols, completed work, and ordered next steps. The replacement task cannot access this conversation.",
		},
		{
			name: "intent",
			required: true,
			contextRequirements: (context) => context.taskHandoffCondensationAvailable === true,
			instruction:
				"Only the desired objective and scope for the replacement task. Use one or two short sentences and no more than 40 words. Do not summarize conversation history, implementation details, files, findings, or completed work; the Utility model will derive those from the current task's conversation history.",
		},
	],
}

export class NewTaskTool implements IDiracTool {
	spec(): DiracToolSpec {
		return new_task_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(args: any, env: IToolEnvironment): Promise<any> {
		const signal = env.orchestration.getTaskState("abortSignal")
		const suppliedContext = this.nonEmptyString(args.context)
		const intent = this.nonEmptyString(args.intent)

		if (suppliedContext && intent) {
			this.incrementMistakeCount(env)
			return formatResponse.toolError("Provide exactly one parameter: context or intent")
		}

		let context = suppliedContext
		let utilityModelIdentity: ConversationCondensationResult["modelIdentity"] | undefined
		if (!context && intent) {
			try {
				const generatedHandoff = await this.generateTaskHandoff(
					intent,
					signal,
					env.conversationCondensation?.condenseConversation,
				)
				context = generatedHandoff.text
				utilityModelIdentity = generatedHandoff.modelIdentity
			} catch (error) {
				if (signal.aborted) throw error
				const message = getErrorMessage(error)
				env.logging.warn("Utility task handoff generation failed", error)
				return formatResponse.toolError(`Utility task-handoff generation failed: ${message}`)
			}
			this.throwIfCancelled(signal)
		}

		if (!context) {
			const parameter = env.conversationCondensation?.isAvailable(TASK_HANDOFF_TEMPLATE_ID) ? "intent" : "context"
			this.incrementMistakeCount(env)
			return formatResponse.toolError(`Missing required parameter: ${parameter}`)
		}

		env.orchestration.setTaskState("consecutiveMistakeCount", 0)
		if (!env.config.isSubagentExecution && env.config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Dirac wants to start a new task...",
				message: `Dirac is suggesting to start a new task with: ${context}`,
			})
		}

		const modelHeaderSuffix = utilityModelIdentity
			? ` · ${utilityModelIdentity.providerId}/${utilityModelIdentity.modelId}`
			: ""

		const cardHandle = await env.ui.createCard({
			header: `New Task${modelHeaderSuffix}`,
			icon: DiracIcon.CHAT,
			requireApproval: true,
			requireFeedback: true,
			rawInput: { tool: DiracDefaultTool.NEW_TASK },
			body: context,
			renderType: "markdown",
			actions: [{ label: "Approve New Task", value: DiracDefaultTool.NEW_TASK, primary: true }],
			collapsed: false,
			maxHeight: 1200,
			do_not_auto_collapse: true,
		})
		return await this.resolvePreview(context, modelHeaderSuffix, cardHandle, signal, env)
	}

	private async resolvePreview(
		context: string,
		modelHeaderSuffix: string,
		cardHandle: ICardHandle,
		signal: AbortSignal,
		env: IToolEnvironment,
	): Promise<any> {
		let previewFinalized = false
		let replacementCommitted = false
		try {
			const { response, value, text, images, files: newTaskFiles } = await cardHandle.waitForInteraction()
			this.throwIfCancelled(signal)

			const provider = env.config.providerId
			const hasFeedback = !!text || !!images?.length || !!newTaskFiles?.length
			const approvedReplacement = response === "approve" && value === DiracDefaultTool.NEW_TASK

			if (hasFeedback) {
				let fileContentString = ""
				if (newTaskFiles && newTaskFiles.length > 0) {
					fileContentString = await processFilesIntoText(newTaskFiles)
					this.throwIfCancelled(signal)
				}
				if (text) await env.ui.upsertText(text, false, "user")
				await cardHandle.finalize(CardStatus.CANCELLED)
				previewFinalized = true
				this.captureDismissal(env, provider)
				return formatResponse.toolResult(
					`The user provided feedback instead of creating a new task:\n<feedback>\n${text ?? ""}\n</feedback>`,
					images,
					fileContentString,
				)
			}

			if (!approvedReplacement) {
				await cardHandle.finalize(CardStatus.CANCELLED)
				previewFinalized = true
				this.captureDismissal(env, provider)
				return formatResponse.toolResult("The user kept the current task.")
			}

			this.throwIfCancelled(signal)
			env.orchestration.requestTaskReplacement(context)
			replacementCommitted = true

			try {
				await cardHandle.update({
					header: `New Task Created${modelHeaderSuffix}`,
					collapsed: true,
				})
				await cardHandle.finalize(CardStatus.SUCCESS)
			} catch (error) {
				env.logging.warn("Failed to present completed task replacement", error)
			}

			return formatResponse.toolResult("The user has created a new task with the provided context.")
		} catch (error) {
			if (!replacementCommitted && !previewFinalized) {
				await this.finalizeInterruptedPreview(cardHandle, signal, env)
			}
			throw error
		}
	}

	private captureDismissal(env: IToolEnvironment, provider: string): void {
		telemetryService.captureToolUsage(
			env.config.ulid,
			this.spec().id,
			env.config.model.id,
			provider,
			false,
			false,
			undefined,
			true,
		)
	}

	private async finalizeInterruptedPreview(cardHandle: ICardHandle, signal: AbortSignal, env: IToolEnvironment): Promise<void> {
		try {
			await cardHandle.finalize(signal.aborted ? CardStatus.CANCELLED : CardStatus.ERROR)
		} catch (error) {
			env.logging.warn("Failed to finalize interrupted new-task preview", error)
		}
	}

	private nonEmptyString(value: unknown): string | undefined {
		if (typeof value !== "string") return undefined
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : undefined
	}

	private incrementMistakeCount(env: IToolEnvironment): void {
		env.orchestration.setTaskState("consecutiveMistakeCount", env.orchestration.getTaskState("consecutiveMistakeCount") + 1)
	}

	private throwIfCancelled(signal: AbortSignal): void {
		if (signal.aborted) throw new Error("Task instance aborted")
	}

	private async generateTaskHandoff(
		intent: string,
		signal: AbortSignal,
		condenseConversation: NonNullable<IToolEnvironment["conversationCondensation"]>["condenseConversation"] | undefined,
	): Promise<ConversationCondensationResult> {
		if (!condenseConversation) {
			throw new Error("Utility task-handoff generation is unavailable")
		}
		return await condenseConversation(TASK_HANDOFF_TEMPLATE_ID, {
			historyScope: "complete",
			signal,
			additionalSourceText: buildTaskHandoffIntentSource(intent),
		})
	}
}

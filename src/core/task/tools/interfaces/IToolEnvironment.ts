import type { TextCondensationTemplateId } from "@core/text-condensation/TextCondenser"
import type {
	AstImplementationRequest,
	AstImplementationResult,
	AstOccurrenceRequest,
	AstOccurrenceResult,
	AstOutlineRequest,
	AstOutlineResult,
	AstRenameRequest,
	AstReplacementRequest,
	SourceMutationPlan,
} from "@services/source-ast/types"
import { FileDiagnostics } from "@shared/proto/index.dirac"
import type { SubagentIdentity } from "@shared/subagents"
import { FileInfo } from "../../../../services/glob/list-files"
import {
	ActionButton,
	BrowserActionResult,
	Card,
	CardLocation,
	CardStatus,
	CleanupStrategy,
	DiracMessage,
	RenderType,
} from "../../../../shared/ExtensionMessage"
import { SkillContent, SkillMetadata } from "../../../../shared/skills"
import { DiracAskResponse } from "../../../../shared/WebviewMessage"
import { HookExecutionResult } from "../../../hooks/hook-executor"
import { TaskState } from "../../TaskState"
import { SubagentProgressUpdate, SubagentRunResult } from "../subagent/SubagentRunner"
import { TaskConfig } from "../types/TaskConfig"
import { IDiracContext } from "./IDiracContext"

export interface ICardHandle {
	readonly collapsed: boolean
	readonly id: string
	readonly header: string
	readonly icon?: string
	readonly renderType: RenderType
	readonly body?: string

	readonly rawInput?: import("../../../../shared/ExtensionMessage").CardRawInput
	readonly rawOutput?: import("../../../../shared/ExtensionMessage").CardRawOutput
	readonly locations?: CardLocation[]
	readonly requireApproval?: boolean
	readonly requireFeedback?: boolean
	readonly feedbackPlaceholder?: string
	readonly actions?: ActionButton[]
	readonly maxHeight?: number
	readonly cleanupStrategy?: CleanupStrategy
	readonly status: CardStatus

	/**
	 * Update the card's metadata or state.
	 */
	update(patch: Partial<Omit<Card, "id">>): Promise<void>

	/**
	 * Blocks until the user interacts with the card (approval, feedback, or custom action).
	 * Returns the action value (e.g., 'approve', 'reject', 'submit', or custom button value).
	 */
	waitForInteraction(): Promise<{
		action: DiracAskResponse | string
		response: DiracAskResponse
		value?: string
		text?: string
		images?: string[]
		files?: string[]
		userEdits?: Record<string, string>
	}>

	/**
	 * Append a small, bounded status update to the existing body.
	 * Callers must not use this for unbounded stdout or log streaming.
	 */
	appendBody(chunk: string): Promise<void>

	/**
	 * Transitions the card to a final state and resolves any pending interaction.
	 */
	finalize(status: CardStatus, doNotAutoCollapse?: boolean): Promise<void>
}

export interface CardParams {
	header: string
	kind?: import("../../../../shared/ExtensionMessage").CardKind
	/** Programmatic name of the tool that created this card. */
	toolName?: string
	icon?: string
	status?: CardStatus
	renderType?: RenderType
	body?: string

	rawInput?: import("../../../../shared/ExtensionMessage").CardRawInput
	rawOutput?: import("../../../../shared/ExtensionMessage").CardRawOutput
	diffs?: import("../../../../shared/ExtensionMessage").CardDiff[]
	locations?: CardLocation[]
	requireApproval?: boolean
	requireFeedback?: boolean
	feedbackPlaceholder?: string
	actions?: ActionButton[]
	autoScroll?: boolean
	collapsed?: boolean
	maxHeight?: number
	cleanupStrategy?: CleanupStrategy
	do_not_auto_collapse?: boolean
	outcome?: string
}

export interface IUITrait {
	/**
	 * Creates a card for tracking execution progress.
	 * This card is purely for observability.
	 */
	createCard(params: CardParams): Promise<ICardHandle>

	/**
	 * Generic upsert for informational messages.
	 */
	upsertText(text: string, isReasoning?: boolean, role?: "user" | "assistant"): Promise<void>

	/**
	 * Creates a text stream for real-time feedback.
	 */
	streamText(type: "markdown" | "reasoning"): Promise<import("../../../../shared/ExtensionMessage").ITextStreamHandle>

	/** Publishes task state changes to the active UI surface. */
	publishState(): Promise<void>
}

export interface IInteractionTrait {
	/**
	 * Triggers a transient permission request.
	 * The UI for this request is separate from any execution cards.
	 */
	askPermission(
		message: string,
		preview?: PermissionPreview,
	): Promise<{
		approved: boolean
		action: string
		value?: string
		text?: string
		images?: string[]
		files?: string[]
		userEdits?: Record<string, string>
		card: ICardHandle
	}>

	/**
	 * Generic ask for followup, plan_mode, new_task, condense, etc.
	 */
}

export interface PermissionPreview {
	diffs?: import("../../../../shared/ExtensionMessage").CardDiff[]
	rawInput?: import("../../../../shared/ExtensionMessage").CardRawInput
}

export interface ITelemetryTrait {
	/**
	 * Captures custom tool usage telemetry.
	 * Standard telemetry (invocation, duration, success) is handled automatically by the coordinator.
	 */
	captureCustomMetadata(metadata: Record<string, any>): void
	captureTaskCompleted(): void
	captureOptionSelected(optionCount: number, mode: import("@shared/storage/types").Mode): void
	captureOptionsIgnored(optionCount: number, mode: import("@shared/storage/types").Mode): void
}

export interface SystemCommandResult {
	userRejected: boolean
	output: unknown
	completed?: boolean
	exitCode?: number | null
	signal?: NodeJS.Signals | null
	logFilePath?: string
}

export interface ISystemTrait {
	/**
	 * Executes a shell command.
	 */
	executeCommand(command: string, options?: { timeout?: number }): Promise<SystemCommandResult>

	/**
	 * Performs a regex search across files.
	 */
	searchFiles(
		directoryPath: string,
		regex: string,
		options?: {
			filePattern?: string
			contextLines?: number
			excludeFilePatterns?: string[]
			debugLog?: (info: Record<string, any>) => Promise<void>
			includeAnchors?: boolean
			noIgnore?: boolean
			allowedNodeModuleScopes?: string[]
		},
	): Promise<string>

	/**
	 * Returns system information for bug reporting.
	 */
	getSystemInfo(): Promise<{
		operatingSystem: string
		diracVersion: string
		hostInfo: string
		systemInfo: string
		providerAndModel: string
	}>

	/**
	 * Opens a URL in the user's default browser.
	 */
	openUrl(url: string): Promise<void>

	/** Shows a native desktop notification when the host supports it. */
	showNotification(options: { title?: string; subtitle?: string; message: string }): void
}

export interface IBrowserTrait {
	launch(url: string): Promise<BrowserActionResult>
	click(coordinate: string): Promise<BrowserActionResult>
	type(text: string): Promise<BrowserActionResult>
	scroll(direction: "up" | "down"): Promise<BrowserActionResult>
	close(): Promise<BrowserActionResult>
}

export interface ISkillsTrait {
	getAvailableSkills(): Promise<SkillMetadata[]>
	getSkillContent(name: string, availableSkills: SkillMetadata[]): Promise<SkillContent | undefined>
	listSupportingFiles(path: string): Promise<{ docs: string[]; scripts: string[] }>
}

export interface IWorkspaceTrait {
	/**
	 * Resolves a relative path or a path with workspace hints into absolute and displayable formats.
	 * @param relPath The path to resolve (e.g., "src/main.ts" or "@frontend:src/index.ts").
	 */
	resolvePath(path: string): Promise<{ absolutePath: string; displayPath: string }>
	/**
	 * Lists files in the specified directory.
	 */
	listFiles(path: string, recursive: boolean, limit: number): Promise<[FileInfo[], boolean]>
	/**
	 * Reads the content of a file.
	 */
	readFile(path: string): Promise<string>
	/**
	 * Reads the content of a file, handling rich formats (PDF, DOCX, images).
	 */
	readRichFile(path: string): Promise<{ text: string; imageBlock?: any }>
	/** Loads user-attached files into model-facing text. */
	formatAttachedFiles(paths: string[]): Promise<string>
	/**
	 * Returns information about a file (size, existence, etc.).
	 */
	getFileInfo(path: string): Promise<{ size: number; isFile: boolean; exists: boolean }>

	/**
	 * Writes content to a file.
	 */
	writeFile(path: string, content: string): Promise<void>
	/**
	 * Saves the document if it has unsaved changes.
	 */
	saveOpenDocumentIfDirty(options: { filePath: string }): Promise<void>
}

export interface SaveResult {
	content: string
	userEdits: boolean
	autoFormatting: boolean
}

export interface IEditorTrait {
	/** Opens the diff/review UI for one or more files */
	showReview(files: { absolutePath: string; displayPath: string; content: string; originalContent?: string }[]): Promise<void>
	/** Hides the review UI */
	hideReview(): Promise<void>
	/** Opens a specific file in the editor */
	open(path: string, options?: { displayPath?: string }): Promise<void>
	/** Updates the content of the currently open editor */
	update(content: string, finalize: boolean): Promise<void>
	/** Saves changes in the current editor, returning auto-formatting and user edits */
	saveChanges(options?: { skipDiagnostics?: boolean }): Promise<SaveResult>
	/** Applies content and saves a file silently (background edit) */
	applyAndSaveSilently(path: string, content: string): Promise<SaveResult>
	/** Applies content and saves multiple files silently in a single transaction */
	applyAndSaveBatchSilently(files: { path: string; content: string }[]): Promise<Map<string, SaveResult>>
	/** Reverts all unsaved changes in the editor */
	revertChanges(): Promise<void>
	/** Resets the editor state */
	reset(): Promise<void>
	/** Scrolls the editor to the first detected difference */
	scrollToFirstDiff(): Promise<void>
	/** Undoes the last set of user edits in the diff view */
	undoUserEdits(): Promise<void>
	/** Formats a file using the editor's configured formatter and returns the formatted content */
	format(path: string): Promise<string>
}

export interface ISourceAstTrait {
	outline(request: AstOutlineRequest): Promise<AstOutlineResult>
	implementations(request: AstImplementationRequest): Promise<AstImplementationResult>
	occurrences(request: AstOccurrenceRequest): Promise<AstOccurrenceResult>
	planRename(request: AstRenameRequest): Promise<SourceMutationPlan>
	planReplacements(request: AstReplacementRequest): Promise<SourceMutationPlan>
	getAnchorFingerprint(path: string): string | null
}

export interface IOrchestrationTrait {
	runSubagent(
		prompt: string,
		options?: {
			subagentName?: string
			taskTitle?: string
			agentIdentity?: SubagentIdentity
			timeout?: number
			includeHistory?: boolean
			useUtilityModel?: boolean
			allowedTools?: string[]
			systemSuffix?: string
			onUpdate?: (update: SubagentProgressUpdate) => void | Promise<void>
		},
	): Promise<SubagentRunResult>

	/**
	 * Executes a lifecycle hook.
	 */
	runHook(name: string, input: any, options?: { isCancellable?: boolean }): Promise<HookExecutionResult>

	/**
	 * Transitions the agent from Plan Mode to Act Mode.
	 */
	switchToActMode(): Promise<boolean>

	/**
	 * Saves a checkpoint of the current task state.
	 */
	saveCheckpoint(isTaskComplete?: boolean, messageId?: string): Promise<void>
	/** Returns false when queued steering supersedes the current completion attempt. */
	commitAttemptCompletion(): Promise<boolean>

	/**
	 * Returns the conversation history.
	 */
	getHistory(): DiracMessage[]

	/**
	 * Updates the conversation history truncation range.
	 */
	setTruncationRange(range: [number, number]): void

	/**
	 * Calculates the next truncation range based on a strategy.
	 */
	getNextTruncationRange(strategy: "none" | "half" | "quarter" | "lastTwo"): [number, number]
	updateMessage(index: number, updates: Partial<DiracMessage>): Promise<void>

	/**
	 * Returns the current runtime task state.
	 */
	getTaskState<T extends keyof TaskState>(key: T): TaskState[T]

	/**
	 * Updates the runtime task state.
	 */
	setTaskState<T extends keyof TaskState>(key: T, value: TaskState[T]): void

	/** Ends the current task and asks its controller to start a replacement after unwind. */
	requestTaskReplacement(context: string, images?: string[], files?: string[]): void

	/** Activates a trusted skill and persists the activation for task resume. */
	activateSkill(skillId: string): Promise<void>

	/**
	 * Checks if the latest task completion has new changes.
	 */
	doesLatestTaskCompletionHaveNewChanges(): Promise<boolean>

	resetTransientState(): Promise<void>
	/** Reports that conversation truncation state was successfully persisted. */
	notifyContextCompacted(): void
}

export interface IDiagnosticsTrait {
	/**
	 * Prepares diagnostics for the specified files.
	 */
	prepare(paths: string[]): Promise<void>

	/**
	 * Returns raw diagnostics for the specified files.
	 */
	getRaw(paths: string[]): Promise<FileDiagnostics[]>

	/**
	 * Formats diagnostics with optional anchored source context for model-facing output.
	 */
	formatProblems(
		diagnostics: FileDiagnostics[],
		fileContentMap?: Map<string, { lines: string[]; hashes?: string[] }>,
		maxErrors?: number,
	): Promise<string>
}

export interface ILoggingTrait {
	error(message: string, ...args: any[]): void
	warn(message: string, ...args: any[]): void
	info(message: string, ...args: any[]): void
	debug(message: string, ...args: any[]): void
	log(message: string, ...args: any[]): void
	trace(message: string, ...args: any[]): void
}

export interface IAnchorTrait {
	reconcile(absolutePath: string, lines: string[]): string[]
	getDocumentFingerprint(absolutePath: string): string | null
}

/**
 * The Tool Environment provides access to all capabilities (traits)
 * available to a modular tool during its execution.
 */
export interface ConversationCondensationResult {
	text: string
	modelIdentity: {
		providerId: string
		modelId: string
	}
}

export interface IConversationCondensationTrait {
	isAvailable(template: TextCondensationTemplateId): boolean
	condenseConversation(
		template: TextCondensationTemplateId,
		options: {
			historyScope: "complete" | "effective"
			signal?: AbortSignal
			additionalSourceText?: string
		},
	): Promise<ConversationCondensationResult>
}

export interface IToolEnvironment {
	readonly telemetry: ITelemetryTrait
	readonly ui: IUITrait
	readonly interaction: IInteractionTrait
	readonly system: ISystemTrait
	readonly workspace: IWorkspaceTrait
	readonly sourceAst: ISourceAstTrait
	readonly diagnostics: IDiagnosticsTrait

	readonly anchors: IAnchorTrait
	readonly editor: IEditorTrait
	readonly browser: IBrowserTrait
	readonly skills: ISkillsTrait
	readonly orchestration: IOrchestrationTrait
	/** Available only to task environments that own their conversation history. */
	readonly conversationCondensation?: IConversationCondensationTrait

	/** Persistent state management */
	readonly context: IDiracContext

	/** The name of the tool being executed */
	readonly toolName: string

	/** Task and environment configuration */
	readonly config: TaskConfig

	/** Structured logging access for tools */
	readonly logging: ILoggingTrait
}

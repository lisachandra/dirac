/**
 * Message translator for converting Dirac messages to ACP session updates.
 *
 * This module handles the translation between Dirac's internal message format
 * (DiracMessage) and the ACP protocol's session update format. A single Dirac
 * message may produce multiple ACP updates.
 *
 * @module acp/messageTranslator
 */

import type * as acp from "@agentclientprotocol/sdk"
import { isSuccessfulTaskCompletionCard } from "@shared/cardIdentity"
import type { DiracMessage } from "@shared/ExtensionMessage"
import { CardStatus, DiracMessageType, isFinalStatus } from "@shared/ExtensionMessage"
import { isPlanResponseCard } from "@shared/responseTool"
import { CardHeader } from "@shared/cardIdentity"
import { getBrowserActionKind } from "./browserActionTranslator.js"
import { isFollowupQuestionCard } from "./questionCard.js"
import type { AcpSessionState, TranslatedMessage } from "./types.js"
import { AcpSessionStatus } from "./types.js"

/**
 * Maps Dirac tool types to ACP ToolKind values.
 */
const TOOL_KIND_MAP: Record<string, acp.ToolKind> = {
	// File operations
	edit_file: "edit",
	editFile: "edit",
	edit_ast: "edit",
	editAst: "edit",
	write_to_file: "edit",
	newFileCreated: "edit",
	editedExistingFile: "edit",
	fileDeleted: "delete",
	read_file: "read",
	readFile: "read",
	read_line_range: "read",
	readLineRange: "read",
	list_files: "read",
	listFilesTopLevel: "read",
	listFilesRecursive: "read",
	list_skills: "read",
	listSkills: "read",
	list_code_definition_names: "read",
	listCodeDefinitionNames: "read",
	search_files: "search",
	searchFiles: "search",
	// Other
	condense: "think",
	use_skill: "other",
	useSkill: "other",
	use_subagents: "other",
	useSubagents: "other",
	execute_command: "execute",
}

/**
 * Generate a unique tool call ID.
 */
function generateToolCallId(): string {
	return crypto.randomUUID()
}

const WEB_SEARCH_MARKER_PATTERN = /^\s*\[Web Search:\s*([\s\S]*?)\]\s*$/
const WEB_SEARCH_FALLBACK_QUERY = "Searching..."

/**
 * Parse Codex's text-only web-search marker.
 *
 * The marker is emitted by the Responses provider as assistant text. ACP has a
 * native search tool-call surface, so the ACP adapter converts exact marker
 * chunks while leaving ordinary prose untouched.
 */
export function parseWebSearchMarkerText(text: string | undefined): string | undefined {
	const match = text?.match(WEB_SEARCH_MARKER_PATTERN)
	if (!match) return undefined

	const query = match[1]?.trim()
	return query || WEB_SEARCH_FALLBACK_QUERY
}

function toolNameForCard(card: { header: string; toolName?: string; rawInput?: Record<string, unknown> }): string {
	if (card.toolName) return card.toolName
	if (typeof card.rawInput?.tool === "string") return card.rawInput.tool
	return card.header
}

/** Hook execution indicators rendered inside Dirac use these headers; ACP hides them. */
function isHookHeader(header: string): boolean {
	return header === "PreToolUse Hook" || header === "PostToolUse Hook"
}

function toolKindForCard(card: {
	header: string
	toolName?: string
	rawInput?: Record<string, unknown>
	kind?: string
}): acp.ToolKind {
	// Task completion is rendered as body markdown (see translateCardMessage early return), but
	// fallback to "other" keeps accidental tool envelope as plain_text/wrench, not collapsed think/brain.
	if (card.header === CardHeader.TASK_COMPLETED || card.header === CardHeader.LEGACY_TASK_COMPLETION) return "other"
	if (card.header === "Proposed Plan") return "other"
	if (card.header.startsWith("New Task")) return "other" // keeps 2-option permission semantics
	if (card.header === "Run Subagents" || card.header.startsWith("Run Subagents:")) return "other" // expanded below, not per-tool
	const toolName = toolNameForCard(card)
	const operation = typeof card.rawInput?.operation === "string" ? card.rawInput.operation : undefined
	if (toolName === "read_file" || toolName === "readFile") return "read"
	if (toolName === "inspect_ast" || toolName === "inspectAst") {
		return operation === "definitions" || operation === "references" || operation === "occurrences" ? "search" : "read"
	}
	if (toolName === "edit_ast" || toolName === "editAst") return "edit"
	if (toolName === "hook_feedback" || toolName === "hook_block") return "other"
	// Real file/terminal headers bypass the exact-key map:
	if (card.header.startsWith("Reading from") || card.header.startsWith("Read from")) return "read"
	if (card.header.startsWith("Listed files in")) return "read"
	if (card.header.startsWith("Searching ")) return "search"
	if (card.header.startsWith("Writing ")) return "edit"
	if (card.header.startsWith("Editing ") || card.header.startsWith("Edited ") || (card.header.startsWith("Apply ") && card.header.includes("edit(s)"))) return "edit"
	if (card.header.startsWith("Hook:")) return "other"
	return TOOL_KIND_MAP[toolName] ?? TOOL_KIND_MAP[card.header] ?? getBrowserActionKind(card.header) ?? "other"
}

/**
 * Options for translating a message.
 */
export interface TranslateMessageOptions {
	/**
	 * An existing toolCallId to use for tool messages.
	 * If provided, updates will be sent as tool_call_update instead of new tool_call.
	 * This is used when updating a streaming tool call that was already created.
	 */
	existingToolCallId?: string
	/**
	 * Capabilities advertised by the ACP client during initialize.
	 */
	clientCapabilities?: acp.ClientCapabilities
}

/**
 * Translate a single Dirac message to ACP session updates.
 *
 * @param message - The Dirac message to translate
 * @param sessionState - The current session state for tracking tool calls
 * @param options - Optional translation options (e.g., existing toolCallId for updates)
 * @returns The translated message with ACP updates and permission requirements
 */
export function translateMessage(
	message: DiracMessage,
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): TranslatedMessage {
	const updates: acp.SessionUpdate[] = []
	let requiresPermission = false
	let permissionRequest: TranslatedMessage["permissionRequest"]
	let toolCallId: string | undefined

	if (message.content.type === DiracMessageType.MARKDOWN) {
		const sayResult = translateMarkdownMessage(message, sessionState, options)
		updates.push(...sayResult.updates)
		toolCallId = sayResult.toolCallId
	} else if (message.content.type === DiracMessageType.CARD) {
		const cardResult = translateCardMessage(message, sessionState, options)
		updates.push(...cardResult.updates)
		requiresPermission = cardResult.requiresPermission ?? false
		permissionRequest = cardResult.permissionRequest
		toolCallId = cardResult.toolCallId
	} else if (message.content.type === DiracMessageType.API_STATUS || message.content.type === DiracMessageType.CHECKPOINT) {
		// API status and checkpoint messages produce no ACP updates
	}

	return {
		updates,
		requiresPermission,
		permissionRequest,
		toolCallId,
	}
}

/**
 * Translate a MARKDOWN type Dirac message to ACP updates.
 */
function translateMarkdownMessage(
	message: DiracMessage,
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): TranslatedMessage {
	const updates: acp.SessionUpdate[] = []
	let toolCallId: string | undefined
	if (message.content.type !== DiracMessageType.MARKDOWN) {
		return { updates: [] }
	}
	const content = message.content
	const text = content.content
	const isReasoning = content.isReasoning
	const isCompletion = content.isCompletion
	const role = content.role

	// Route by content properties
	if (role === "user") {
		// User messages — already visible to user, don't echo
		return { updates: [] }
	}

	if (isReasoning) {
		// Reasoning → agent_thought_chunk
		if (text) {
			updates.push({
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text },
			})
		}
		return { updates }
	}

	if (isCompletion) {
		// Completion result → agent_message_chunk with leading newline
		if (text) {
			updates.push({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "\n" + text },
			})
		}
		return { updates }
	}

	// Regular text → check for web search marker, then agent_message_chunk
	if (text) {
		const webSearchQuery = parseWebSearchMarkerText(text)
		if (webSearchQuery) {
			toolCallId = translateWebSearchMarkerMessage(webSearchQuery, sessionState, updates)
			return { updates, toolCallId }
		}

		// Clear retry tool call when streaming begins
		if (sessionState.retryToolCallId) {
			updates.push({
				sessionUpdate: "tool_call_update",
				toolCallId: sessionState.retryToolCallId,
				status: "completed",
			})
			sessionState.retryToolCallId = undefined
		}

		updates.push({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		})
	}

	return { updates, toolCallId }
}

/**
 * Translate a web search marker to ACP tool_call lifecycle.
 *
 * Web search markers are complete text chunks (the regex requires a closing `]`),
 * so they are always emitted with a terminal "completed" status.
 */
function translateWebSearchMarkerMessage(query: string, sessionState: AcpSessionState, updates: acp.SessionUpdate[]): string {
	const toolCallId = sessionState.currentToolCallId || generateToolCallId()

	const isExistingToolCall = !!sessionState.currentToolCallId

	if (!isExistingToolCall) {
		sessionState.currentToolCallId = toolCallId
		updates.push({
			sessionUpdate: "tool_call",
			toolCallId,
			name: "web_search",
			title: `Web Search: ${query}`,
			kind: "search",
			status: "pending",
			rawInput: { query },
		})
	}

	if (!isExistingToolCall) {
		updates.push({ sessionUpdate: "tool_call_update", toolCallId, name: "web_search", status: "in_progress" })
	}

	updates.push({
		sessionUpdate: "tool_call_update",
		toolCallId,
		name: "web_search",
		status: "completed",
		rawInput: { query },
		rawOutput: { query },
	})
	sessionState.currentToolCallId = undefined

	return toolCallId
}

/**
 * Translate a CARD type Dirac message to ACP updates.
 *
 * - Task Completed & Proposed Plan: body markdown (agent_message_chunk), no think/tool chrome, no plan->todo.
 * - Everything else: tool_call with inline content[] where applicable.
 */
function translateCardMessage(
	message: DiracMessage,
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): TranslatedMessage {
	if (message.content.type !== DiracMessageType.CARD) {
		return { updates: [], requiresPermission: false }
	}
	const card = message.content.card
	// Task Completed and Proposed Plan outside think: render body as plain markdown.
	// Task turn boundary (end_turn) still via checkMessageForPromptResolution.
	const isProposedPlanBody = isPlanResponseCard(card as any)
	// Follow-up question cards on clients without form elicitation are rendered
	// as native markdown (like Task Completed / Proposed Plan) so the user sees
	// the question text and options inline instead of a bare tool block. When
	// the client negotiates `elicitation.form` the bridge answers through a
	// first-class form, so this fallback is gated on the capability being absent.
	const formElicitationNegotiated =
		options?.clientCapabilities?.elicitation?.form != null
	if (
		!formElicitationNegotiated &&
		isFollowupQuestionCard(message)
	) {
		const lines: string[] = []
		const bodyText = typeof card.body === "string" ? card.body.trim() : ""
		if (bodyText) lines.push(bodyText)
		if (card.actions?.length) {
			lines.push("")
			lines.push("**Options:**")
			for (const action of card.actions) {
				lines.push(`- ${action.label}`)
			}
		}
		lines.push("")
		lines.push(
			"*(This client does not support inline forms — provide your answer in the next prompt.)*",
		)
		return {
			updates: [
				{
					sessionUpdate: "agent_message_chunk",
					content: { type: "text" as const, text: lines.join("\n") },
				} as unknown as acp.SessionUpdate,
			],
			requiresPermission: false,
		}
	}
	if (
		card.header === CardHeader.TASK_COMPLETED ||
		card.header === CardHeader.LEGACY_TASK_COMPLETION ||
		isProposedPlanBody
	) {
		const bodyText = typeof card.body === "string" ? card.body.trim() : ""
		let taskText = bodyText
		if (bodyText.startsWith("{")) {
			try {
				const parsed = JSON.parse(bodyText) as { response?: unknown }
				if (typeof parsed.response === "string" && parsed.response.trim()) {
					taskText = parsed.response.trim()
				}
			} catch {}
		}
		// Proposed Plan is always body markdown — never a Paseo todo/plan checkbox.
		// The WAITING_FOR_INPUT state is still carried via TaskState/CARD for Dirac's
		// submitCardResponse, but Paseo should show the plan inline immediately.
		if (taskText) {
			const isCompletionBody =
				card.header === CardHeader.TASK_COMPLETED ||
				card.header === CardHeader.LEGACY_TASK_COMPLETION
			if (isCompletionBody) {
				if (sessionState.emittedCompletionCardIds.has(card.id)) {
					return { updates: [], requiresPermission: false }
				}
				sessionState.emittedCompletionCardIds.add(card.id)
			}
			if (isProposedPlanBody) {
				if (sessionState.emittedPlanCardIds.has(card.id)) {
					return { updates: [], requiresPermission: false }
				}
				sessionState.emittedPlanCardIds.add(card.id)
			}
			return {
				updates: [
					{
						sessionUpdate: "agent_message_chunk",
						content: { type: "text" as const, text: taskText },
					} as unknown as acp.SessionUpdate,
				],
				requiresPermission: false,
			}
		}
		// empty body: suppress any plan->todo/tool chrome
		return { updates: [], requiresPermission: false }
	}
	// Hook execution indicators are for Dirac internal tracking; hide the
	// noisy running/completed (hasJsonResponse) markers. Block advisories
	// are surfaced as separate hook_feedback/hook_block cards instead.
	if (isHookHeader(card.header)) {
		const isPending = card.status === CardStatus.RUNNING || card.status === CardStatus.BUILDING || card.status === CardStatus.PENDING
		if (isPending) return { updates: [], requiresPermission: false }
		// Completed hooks that are just JSON bookkeeping (hasJsonResponse) are hidden;
		// feedback/blocks are visible via their own cards.
		try {
			const bodyObj = JSON.parse(card.body ?? "{}")
			if (bodyObj?.hasJsonResponse === true || bodyObj?.suppressOutput === true) {
				// final indicator, not advisory
				if (!bodyObj?.contextModification?.trim() && !bodyObj?.errorMessage?.trim()) {
					return { updates: [], requiresPermission: false }
				}
			}
		} catch {}
		// Falls through only if hook carried advisory/error payload
	}
	const toolCallId = card.id
	const updates: acp.SessionUpdate[] = []
	let requiresPermission = false
	let permissionRequest: TranslatedMessage["permissionRequest"]

	// Map CardStatus to ACP ToolCallStatus
	const mapStatus = (s: CardStatus): acp.ToolCallStatus => {
		switch (s) {
			case CardStatus.RUNNING:
			case CardStatus.BUILDING:
			case CardStatus.PENDING:
				return "in_progress"
			case CardStatus.SUCCESS:
				return "completed"
			case CardStatus.ERROR:
			case CardStatus.CANCELLED:
			case CardStatus.ABANDONED:
			case CardStatus.SKIPPED:
				return "failed"
			case CardStatus.WAITING_FOR_INPUT:
				return "pending"
			default:
				return "in_progress"
		}
	}

	const actualStatus = mapStatus(card.status)
	const status = actualStatus === "in_progress" ? "pending" : actualStatus
	const locations = card.locations?.map((location) => ({
		path: location.path,
		...(location.line === undefined ? {} : { line: location.line }),
	}))
	const isExisting = sessionState.pendingToolCalls.has(toolCallId)
	const kind = toolKindForCard(card)
	const name = toolNameForCard(card)
	// Prefer structured content[] for diffs; fall back to plain-text bodies.
	// Expose duplicate keys (content + text) so Paseo's extractToolText/readString finds bodies.
	const bodyText = typeof card.body === "string" ? card.body : undefined
	const rawInput = card.rawInput ?? (bodyText ? { body: bodyText, content: bodyText, text: bodyText } : undefined)
	const rawOutput = card.rawOutput ?? (bodyText ? { body: bodyText, content: bodyText, text: bodyText } : undefined)
	// Inline bodies so Paseo renders without expanding Other. Include edit so approval/batched
	// cards without diffs[] still reach buildEditToolDetail as unifiedDiff.
	let content = card.diffs?.map((diff) => ({ type: "diff" as const, ...diff }))
	if (!content && bodyText && (kind === "read" || kind === "search" || kind === "other" || kind === "think" || kind === "edit")) {
		// body is e.g. "✓ Successfully read X", plan markdown, or "Task Completed" result
		if (bodyText.trim()) {
			content = [{ type: "content" as const, content: { type: "text" as const, text: bodyText } } as any]
		}
	}
	if (isExisting) {
		const existing = sessionState.pendingToolCalls.get(toolCallId)!
		existing.status = actualStatus
		existing.title = card.header
		updates.push({
			sessionUpdate: "tool_call_update",
			toolCallId,
			name,
			title: card.header,
			status: actualStatus,
			locations,
			content,
			rawInput,
			rawOutput,
		})
		if (isFinalStatus(card.status)) {
			sessionState.pendingToolCalls.delete(toolCallId)
		}
	} else {
		const toolCall: acp.ToolCall = {
			toolCallId,
			name,
			title: card.header,
			kind,
			status,
			locations,
			content,
			rawInput,
			rawOutput,
		}
		updates.push({ sessionUpdate: "tool_call", ...toolCall })
		if (actualStatus === "in_progress") {
			updates.push({ sessionUpdate: "tool_call_update", toolCallId, name, status: "in_progress", locations })
		}
		if (!isFinalStatus(card.status)) {
			sessionState.pendingToolCalls.set(toolCallId, toolCall)
		}
	}

	if (isSuccessfulTaskCompletionCard(card) && card.body) {
		updates.push({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: card.body },
		})
	}

	// Permission requests are exclusively for real approval decisions.
	if (card.status === CardStatus.WAITING_FOR_INPUT && card.requireApproval) {
		const existingToolCall = sessionState.pendingToolCalls.get(toolCallId) || {
			toolCallId,
			name,
			title: card.header,
			kind,
			status: "pending" as acp.ToolCallStatus,
			locations,
		}
		const isNewTaskTransition = card.rawInput?.tool === "new_task"
		requiresPermission = true
		permissionRequest = {
			toolCall: existingToolCall as acp.ToolCall,
			options: isNewTaskTransition
				? [
					{ kind: "allow_once", optionId: "new_task", name: card.actions?.[0]?.label ?? "Start new task" },
					{ kind: "reject_once", optionId: "reject_once", name: "Keep current task" },
				]
				: [
					{ kind: "allow_once", optionId: "allow_once", name: "Approve once" },
					{ kind: "allow_always", optionId: "allow_always", name: "Always approve" },
					{ kind: "reject_once", optionId: "reject_once", name: "Reject once" },
					{ kind: "reject_always", optionId: "reject_always", name: "Always reject" },
				]
		}
	}

	return { updates, requiresPermission, permissionRequest, toolCallId }
}

/**
 * Translate multiple Dirac messages to ACP session updates.
 *
 * @param messages - Array of Dirac messages to translate
 * @param sessionState - The current session state
 * @returns Combined array of ACP session updates
 */
export function translateMessages(
	messages: DiracMessage[],
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): acp.SessionUpdate[] {
	const allUpdates: acp.SessionUpdate[] = []

	for (const message of messages) {
		const result = translateMessage(message, sessionState, options)
		allUpdates.push(...result.updates)
	}

	return allUpdates
}

/**
 * Create an initial session state for tracking tool calls.
 */
export function createSessionState(sessionId: string): AcpSessionState {
	return {
		sessionId,
		status: AcpSessionStatus.Idle,
		pendingToolCalls: new Map(),
		emittedPlanCardIds: new Set(),
		emittedCompletionCardIds: new Set(),
	}
}

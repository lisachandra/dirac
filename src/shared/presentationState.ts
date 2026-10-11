import { DiracMessage, DiracMessageType } from "./ExtensionMessage"
import { PresentationBatch, PresentationOperation } from "./PresentationOperation"

export interface MutablePresentationState {
	messages: DiracMessage[]
	messageIndexById: Map<string, number>
	surfaceId?: string
	offset: number
}

export type PresentationBatchResult = "applied" | "gap" | "wrong_surface"

export function createPresentationState(
	messages: DiracMessage[] = [],
	surfaceId?: string,
	offset = -1,
): MutablePresentationState {
	return {
		messages,
		messageIndexById: indexMessages(messages),
		surfaceId,
		offset,
	}
}

export function applyPresentationBatch(
	state: MutablePresentationState,
	batch: PresentationBatch,
): { result: PresentationBatchResult; changedMessages: DiracMessage[] } {
	if (state.surfaceId !== batch.surfaceId) return { result: "wrong_surface", changedMessages: [] }

	const changedMessages: DiracMessage[] = []
	const appendChunks = new Map<string, string[]>()
	for (const operation of batch.operations) {
		if (operation.offset <= state.offset) continue
		if (operation.offset !== state.offset + 1 && operation.type !== "reset") {
			materializeAllPresentationAppends(state, appendChunks)
			return { result: "gap", changedMessages: [] }
		}
		const changed = applyOperation(state, appendChunks, operation)
		if (operation.type === "reset") changedMessages.push(...state.messages)
		else if (changed) changedMessages.push(changed)
		state.offset = operation.offset
	}
	materializeAllPresentationAppends(state, appendChunks)
	return { result: "applied", changedMessages }
}

function materializePresentationAppend(
	state: MutablePresentationState,
	appendChunks: Map<string, string[]>,
	messageId: string,
): void {
	const chunks = appendChunks.get(messageId)
	if (!chunks) return
	const index = state.messageIndexById.get(messageId)
	if (index === undefined) throw new Error(`Presentation append refers to missing ID ${messageId}`)
	const message = state.messages[index]
	const appendedText = chunks.join("")
	if (message.content.type === DiracMessageType.MARKDOWN) {
		message.content.content += appendedText
	} else if (message.content.type === DiracMessageType.CARD) {
		message.content.card.body = `${message.content.card.body ?? ""}${appendedText}`
	} else {
		throw new Error(`Presentation append refers to non-text message ${messageId}`)
	}
	appendChunks.delete(messageId)
}

function materializeAllPresentationAppends(state: MutablePresentationState, appendChunks: Map<string, string[]>): void {
	for (const messageId of appendChunks.keys()) materializePresentationAppend(state, appendChunks, messageId)
}

function applyOperation(
	state: MutablePresentationState,
	appendChunks: Map<string, string[]>,
	operation: PresentationOperation,
): DiracMessage | undefined {
	if (operation.type === "reset") {
		appendChunks.clear()
		state.messages = operation.messages
		state.messageIndexById = indexMessages(operation.messages)
		return undefined
	}
	if (operation.type === "create") {
		if (state.messageIndexById.has(operation.message.id)) throw new Error(`Duplicate presentation ID ${operation.message.id}`)
		state.messageIndexById.set(operation.message.id, state.messages.length)
		state.messages.push(operation.message)
		return operation.message
	}

	const index = state.messageIndexById.get(operation.id)
	if (index === undefined) throw new Error(`Presentation operation refers to missing ID ${operation.id}`)
	if (operation.type === "append_card_body" || operation.type === "append_markdown") {
		const chunks = appendChunks.get(operation.id)
		if (chunks) chunks.push(operation.text)
		else appendChunks.set(operation.id, [operation.text])
		return state.messages[index]
	}
	if (operation.type === "delete") {
		appendChunks.delete(operation.id)
		state.messages.splice(index, 1)
		state.messageIndexById = indexMessages(state.messages)
		return undefined
	}

	materializePresentationAppend(state, appendChunks, operation.id)
	const message = state.messages[index]
	if (operation.type === "patch_message") {
		const patchedMessage = { ...message, ...operation.patch }
		state.messages[index] = patchedMessage
		return patchedMessage
	}
	if (operation.type === "patch_card") {
		if (message.content.type !== DiracMessageType.CARD) throw new Error(`Presentation ID ${operation.id} is not a Card`)
		const card = { ...message.content.card, ...operation.patch }
		const patchedMessage: DiracMessage = {
			...message,
			content: { type: DiracMessageType.CARD, card },
		}
		state.messages[index] = patchedMessage
		return patchedMessage
	}
	if (operation.type === "patch_api_status") {
		if (message.content.type !== DiracMessageType.API_STATUS)
			throw new Error(`Presentation ID ${operation.id} is not an API status`)
		const status = { ...message.content.status, ...operation.patch }
		for (const key of operation.deletions ?? []) delete status[key]
		const patchedMessage: DiracMessage = {
			...message,
			content: { type: DiracMessageType.API_STATUS, status },
		}
		state.messages[index] = patchedMessage
		return patchedMessage
	}
	if (message.content.type !== DiracMessageType.MARKDOWN) throw new Error(`Presentation ID ${operation.id} is not markdown`)
	const content = { ...message.content, ...operation.patch }
	const patchedMessage: DiracMessage = { ...message, content }
	state.messages[index] = patchedMessage
	return patchedMessage
}

function indexMessages(messages: readonly DiracMessage[]): Map<string, number> {
	const indexes = new Map<string, number>()
	for (let index = 0; index < messages.length; index++) indexes.set(messages[index].id, index)
	return indexes
}

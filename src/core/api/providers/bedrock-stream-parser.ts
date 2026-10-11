/**
 * Bedrock ConverseStream chunk parser. Extracted from `bedrock.ts` (FB-15b).
 *
 * Chunks are typed against the SDK's `ConverseStreamOutput` union. The
 * reasoning payloads that Anthropic-on-Bedrock emits extend beyond the strict
 * SDK shapes, so those fields are read through the small structural
 * interfaces documented below.
 */
import type { ConverseStreamOutput, TokenUsage } from "@aws-sdk/client-bedrock-runtime"
import type { ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import type { ApiStreamChunk } from "../transform/stream"

/** Reasoning blocks delivered via metadata.additionalModelResponseFields. */
interface ThinkingResponseFields {
	reasoning?: Array<{ type: string; text?: string; signature?: string }>
}

/** additionalModelResponseFields is delivered by Bedrock but absent from the published SDK event shape. */
type MetadataWithThinkingFields = {
	additionalModelResponseFields?: { thinkingResponse?: ThinkingResponseFields }
}

/** Reasoning fields delivered on contentBlockStart beyond the strict SDK event shape. */
interface ReasoningStartFields {
	type?: string
	thinking?: string
	signature?: string
}

/** Fields delivered on contentBlockDelta beyond the strict SDK ContentBlockDelta union. */
interface ReasoningDeltaFields {
	type?: string
	text?: string
	thinking?: string
	signature?: string
	reasoningContent?: { text?: string }
	toolUse?: { input: string }
}

export class BedrockStreamParser {
	private reasoningBlocks = new Set<number>()
	private activeToolCalls = new Map<number, { toolUseId: string; name: string }>()

	public *parseChunk(chunk: ConverseStreamOutput, modelInfo: ModelInfo): Generator<ApiStreamChunk> {
		yield* this.handleMetadata(chunk, modelInfo)
		yield* this.handleContentBlockStart(chunk)
		yield* this.handleContentBlockDelta(chunk)
		yield* this.handleContentBlockStop(chunk)
		yield* this.handleStreamError(chunk)
	}

	private *handleMetadata(chunk: ConverseStreamOutput, modelInfo: ModelInfo): Generator<ApiStreamChunk> {
		if (!chunk.metadata) return
		const thinkingResponse = (chunk.metadata as MetadataWithThinkingFields).additionalModelResponseFields?.thinkingResponse
		if (thinkingResponse) yield* this.parseThinkingResponse(thinkingResponse)
		if (chunk.metadata.usage) yield this.buildUsageChunk(chunk.metadata.usage, modelInfo)
	}

	private *parseThinkingResponse(thinkingResponse: ThinkingResponseFields): Generator<ApiStreamChunk> {
		for (const block of thinkingResponse.reasoning ?? []) {
			if (block.type !== "text" || !block.text) continue
			yield block.signature
				? { type: "reasoning", reasoning: block.text, signature: block.signature }
				: { type: "reasoning", reasoning: block.text }
		}
	}

	private buildUsageChunk(usage: TokenUsage, modelInfo: ModelInfo): ApiStreamChunk {
		const inputTokens = usage.inputTokens || 0
		const outputTokens = usage.outputTokens || 0
		const cacheReadInputTokens = usage.cacheReadInputTokens || 0
		const cacheWriteInputTokens = usage.cacheWriteInputTokens || 0
		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheReadTokens: cacheReadInputTokens,
			cacheWriteTokens: cacheWriteInputTokens,
			totalCost: calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteInputTokens, cacheReadInputTokens),
		}
	}

	private *handleContentBlockStart(chunk: ConverseStreamOutput): Generator<ApiStreamChunk> {
		if (!chunk.contentBlockStart) return
		const blockStart = chunk.contentBlockStart as unknown as ContentBlockStartFields
		const blockIndex = blockStart.contentBlockIndex
		const start = blockStart.start
		if (start?.toolUse?.toolUseId && start.toolUse.name && blockIndex !== undefined) {
			this.activeToolCalls.set(blockIndex, { toolUseId: start.toolUse.toolUseId, name: start.toolUse.name })
		}
		yield* this.handleThinkingBlockStart(blockStart, blockIndex)
		yield* this.handleRedactedThinkingBlockStart(blockStart)
	}

	/**
	 * contentBlockStart fields. The SDK event carries them under `start`, but some
	 * providers nest them under `contentBlock` or inline at the block level — all
	 * three locations are checked independently (not short-circuited with ??).
	 */
	private blockStartType(blockStart: ContentBlockStartFields): "thinking" | "redacted_thinking" | undefined {
		for (const type of [blockStart.start?.type, blockStart.contentBlock?.type, blockStart.type]) {
			if (type === "thinking" || type === "redacted_thinking") return type
		}
		return undefined
	}

	private *handleThinkingBlockStart(
		blockStart: ContentBlockStartFields,
		blockIndex: number | undefined,
	): Generator<ApiStreamChunk> {
		if (this.blockStartType(blockStart) !== "thinking" || blockIndex === undefined) return
		this.reasoningBlocks.add(blockIndex)
		const signature = blockStart.start?.signature || blockStart.contentBlock?.signature || undefined
		const initialContent = blockStart.start?.thinking || blockStart.contentBlock?.thinking || blockStart.thinking || ""
		if (initialContent || signature) {
			yield { type: "reasoning", reasoning: initialContent, ...(signature ? { signature } : {}) }
		}
	}

	private *handleRedactedThinkingBlockStart(blockStart: ContentBlockStartFields): Generator<ApiStreamChunk> {
		if (this.blockStartType(blockStart) !== "redacted_thinking") return
		yield {
			type: "reasoning",
			reasoning: "[Redacted thinking block]",
			...(blockStart.data ? { redacted_data: blockStart.data } : {}),
		}
	}

	private *handleContentBlockDelta(chunk: ConverseStreamOutput): Generator<ApiStreamChunk> {
		if (!chunk.contentBlockDelta) return
		const blockIndex = chunk.contentBlockDelta.contentBlockIndex
		if (blockIndex === undefined) return
		const delta = chunk.contentBlockDelta.delta as unknown as ReasoningDeltaFields | undefined
		yield* this.parseDelta(delta, blockIndex)
	}

	private *parseDelta(delta: ReasoningDeltaFields | undefined, blockIndex: number): Generator<ApiStreamChunk> {
		if (delta?.type === "signature_delta" && delta.signature) {
			yield { type: "reasoning", reasoning: "", signature: delta.signature }
			return
		}
		if (delta?.type === "thinking_delta" || delta?.thinking) {
			const thinkingContent = delta.thinking || delta.text || ""
			if (thinkingContent) yield { type: "reasoning", reasoning: thinkingContent }
			return
		}
		if (delta?.reasoningContent?.text) {
			yield { type: "reasoning", reasoning: delta.reasoningContent.text }
			return
		}
		if (delta?.toolUse) {
			yield* this.parseToolUseDelta(delta.toolUse.input, blockIndex)
			return
		}
		if (delta?.text) {
			yield* this.parseTextDelta(delta.text, blockIndex)
		}
	}

	private *parseToolUseDelta(toolInput: unknown, blockIndex: number): Generator<ApiStreamChunk> {
		const toolCall = this.activeToolCalls.get(blockIndex)
		if (!toolCall || typeof toolInput !== "string") return
		yield {
			type: "tool_calls",
			tool_call: {
				call_id: toolCall.toolUseId,
				function: { id: toolCall.toolUseId, name: toolCall.name, arguments: toolInput },
			},
		}
	}

	private *parseTextDelta(textContent: string, blockIndex: number): Generator<ApiStreamChunk> {
		yield this.reasoningBlocks.has(blockIndex)
			? { type: "reasoning", reasoning: textContent }
			: { type: "text", text: textContent }
	}

	private *handleContentBlockStop(chunk: ConverseStreamOutput): Generator<ApiStreamChunk> {
		if (!chunk.contentBlockStop) return
		const blockIndex = chunk.contentBlockStop.contentBlockIndex
		if (blockIndex === undefined) return
		this.reasoningBlocks.delete(blockIndex)
		this.activeToolCalls.delete(blockIndex)
	}

	private *handleStreamError(chunk: ConverseStreamOutput): Generator<ApiStreamChunk> {
		if (chunk.internalServerException) {
			yield { type: "text", text: `[ERROR] Internal server error: ${chunk.internalServerException.message}` }
		} else if (chunk.modelStreamErrorException) {
			yield { type: "text", text: `[ERROR] Model stream error: ${chunk.modelStreamErrorException.message}` }
		} else if (chunk.validationException) {
			const message = chunk.validationException.message || ""
			const isContextError = /input.*too long|context.*exceed|maximum.*token|input length.*max.*tokens/i.test(message)
			if (isContextError) throw chunk.validationException
			yield { type: "text", text: `[ERROR] Validation error: ${message}` }
		} else if (chunk.throttlingException) {
			yield { type: "text", text: `[ERROR] Throttling error: ${chunk.throttlingException.message}` }
		} else if (chunk.serviceUnavailableException) {
			yield { type: "text", text: `[ERROR] Service unavailable: ${chunk.serviceUnavailableException.message}` }
		}
	}
}

/** contentBlockStart payload with the reasoning extensions this parser reads. */
interface ContentBlockStartFields {
	contentBlockIndex?: number
	start?: ReasoningStartFields & { toolUse?: { toolUseId: string; name: string } }
	contentBlock?: ReasoningStartFields
	type?: string
	thinking?: string
	data?: string
}

import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { StateManager } from "@core/storage/StateManager"
import { ModelInfo, stripOpenRouterPreset } from "@shared/api"
import { normalizeLegacySynthetic1mModelId } from "@shared/storage/legacy-model-id-migration"
import axios from "axios"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { DiracStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { formatOpenAiCompatibleUsage } from "../transform/openai-usage"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import { OpenRouterErrorResponse } from "./types"

interface OpenRouterHandlerOptions extends CommonApiHandlerOptions {
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: ModelInfo
	openRouterProviderSorting?: string
	openRouterPinnedProviders?: Record<string, string[]>
	openRouterPreventFallbacks?: boolean
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	enableParallelToolCalling?: boolean
}

const dynamicModelInfoDefaults: ModelInfo = { supportsPromptCache: false }
const OPENROUTER_GENERATION_DETAILS_TIMEOUT_MS = 2_000

export class OpenRouterHandler implements ApiHandler {
	private options: OpenRouterHandlerOptions
	private client: OpenAI | undefined
	private abortController?: AbortController
	lastGenerationId?: string

	constructor(options: OpenRouterHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openRouterApiKey) {
				throw new Error("OpenRouter API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://openrouter.ai/api/v1",
					apiKey: this.options.openRouterApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://dirac.run",
						"X-OpenRouter-Title": "Dirac",
						"X-OpenRouter-Categories": "cli-agent,ide-extension",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenRouter client: ${error.message}`)
			}
		}
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController

		try {
			yield* this.createMessageWithSignal(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry()
	private async *createMessageWithSignal(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: OpenAITool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const client = this.ensureClient()
		this.lastGenerationId = undefined

		const model = this.getModel()
		const routingModelId = normalizeLegacySynthetic1mModelId(model.id)
		Logger.info(
			`[OpenRouter routing] ${JSON.stringify({
				model: model.id,
				routingModelId,
				providerSorting: this.options.openRouterProviderSorting,
				allowedProviders: this.options.openRouterPinnedProviders?.[routingModelId],
				preventFallbacks: this.options.openRouterPreventFallbacks,
			})}`,
		)
		const stream = await createOpenRouterStream(
			client,
			systemPrompt,
			messages,
			model,
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			{
				sort: this.options.openRouterProviderSorting,
				allowedProviders: this.options.openRouterPinnedProviders?.[routingModelId],
				preventFallbacks: this.options.openRouterPreventFallbacks,
			},
			tools,
			this.options.enableParallelToolCalling,
			signal,
		)

		let didLogResponseMetadata = false
		let streamUsage: ApiStreamUsageChunk | undefined
		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			if (!didLogResponseMetadata) {
				const responseMetadata = chunk as typeof chunk & { provider?: string; model?: string }
				Logger.info(
					`[OpenRouter response] ${JSON.stringify({
						generationId: chunk.id,
						model: responseMetadata.model,
						provider: responseMetadata.provider,
					})}`,
				)
				didLogResponseMetadata = true
			}
			// openrouter returns an error object instead of the openai sdk throwing an error
			// Check for error field directly on chunk
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				Logger.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`OpenRouter API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			// Check for error in choices[0].finish_reason
			// OpenRouter may return errors in a non-standard way within choices
			const choice = chunk.choices?.[0]
			// Use type assertion since OpenRouter uses non-standard "error" finish_reason
			if ((choice?.finish_reason as string) === "error") {
				// Use type assertion since OpenRouter adds non-standard error property
				const choiceWithError = choice as any
				if (choiceWithError.error) {
					const error = choiceWithError.error
					Logger.error(
						`OpenRouter Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`,
					)
					// Format error details
					const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)
					throw new Error(`OpenRouter Mid-Stream Error: ${errorDetails}`)
				}
				// Fallback if error details are not available
				throw new Error(`OpenRouter Mid-Stream Error: Stream terminated with error status but no error details provided`)
			}

			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (delta && "reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
				}
			}

			// OpenRouter passes reasoning details that we can pass back unmodified in api requests to preserve reasoning traces for model
			// See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
			if (
				delta &&
				"reasoning_details" in delta &&
				Array.isArray(delta.reasoning_details) &&
				delta.reasoning_details.length > 0
			) {
				yield {
					type: "reasoning",
					reasoning: "",
					details: delta.reasoning_details,
				}
			}

			if (!streamUsage && chunk.usage) {
				streamUsage = formatOpenAiCompatibleUsage(chunk.usage, this.getModel().info, { estimateCost: false })
			}
		}

		if (streamUsage?.totalCost !== undefined) {
			yield streamUsage
			return
		}

		const providerUsage = await this.getApiStreamUsage(signal, streamUsage)
		if (providerUsage) {
			yield providerUsage
			return
		}

		if (streamUsage) yield streamUsage
	}

	async getApiStreamUsage(
		signal?: AbortSignal,
		fallbackUsage?: ApiStreamUsageChunk,
	): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				await setTimeoutPromise(500, undefined, { signal }) // FIXME: necessary delay to ensure generation endpoint is ready
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId, signal)
				const generation = (await generationIterator.next()).value
				if (signal?.aborted) return undefined
				if (!generation) return undefined

				const hasProviderUsage = [
					generation.native_tokens_prompt,
					generation.native_tokens_completion,
					generation.native_tokens_cached,
					generation.native_tokens_cache_write,
					generation.total_cost,
				].some((value) => value !== undefined && value !== null)
				if (!hasProviderUsage) return undefined

				return formatOpenAiCompatibleUsage(
					{
						prompt_tokens:
							generation.native_tokens_prompt ??
							(fallbackUsage ? fallbackUsage.inputTokens + (fallbackUsage.cacheReadTokens ?? 0) : undefined),
						completion_tokens: generation.native_tokens_completion ?? fallbackUsage?.outputTokens,
						prompt_tokens_details: {
							cached_tokens: generation.native_tokens_cached ?? fallbackUsage?.cacheReadTokens,
							cache_write_tokens: generation.native_tokens_cache_write ?? fallbackUsage?.cacheWriteTokens,
						},
						cost: generation.total_cost,
					},
					this.getModel().info,
					{ estimateCost: false },
				)
			} catch (error) {
				if (signal?.aborted) return undefined
				// ignore if fails
				Logger.error("Error fetching OpenRouter generation details:", error)
			}
		}
		return undefined
	}

	/** One bounded attempt: billing metadata must not delay an otherwise completed inference response. */
	async *fetchGenerationDetails(genId: string, signal?: AbortSignal) {
		// Logger.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
				timeout: OPENROUTER_GENERATION_DETAILS_TIMEOUT_MS,
				signal,
				...getAxiosSettings(),
			})
			const generation = response.data?.data
			Logger.info(
				`[OpenRouter generation] ${JSON.stringify({
					generationId: genId,
					model: generation?.model,
					provider: generation?.provider_name ?? generation?.provider,
				})}`,
			)
			yield generation
		} catch (error) {
			if (signal?.aborted) return
			// ignore if fails
			Logger.error("Error fetching OpenRouter generation details:", error)
			throw error
		}
	}

	shouldEstimateCost(): boolean {
		return false
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		if (!this.options.openRouterModelId) {
			throw new Error("OpenRouter model ID is required")
		}
		const modelId = normalizeLegacySynthetic1mModelId(this.options.openRouterModelId)
		const baseModelId = stripOpenRouterPreset(modelId)
		const cachedModelInfo = StateManager.get().getModelInfo("openRouter", baseModelId || modelId)
		return { id: modelId, info: this.options.openRouterModelInfo || cachedModelInfo || dynamicModelInfoDefaults }
	}
}

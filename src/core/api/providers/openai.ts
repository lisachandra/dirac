import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity"
import { azureOpenAiDefaultApiVersion, ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI, { AzureOpenAI } from "openai"
import type { ChatCompletionReasoningEffort, ChatCompletionTool } from "openai/resources/chat/completions"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { DiracStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient, fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { addReasoningContent } from "../transform/r1-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { formatOpenAiCompatibleUsage } from "../transform/openai-usage"
import { isParallelToolCallingEnabled } from "@/utils/model-utils"

/**
 * Async-iterate `head` first, then the remainder of `iterator`. Used to splice
 * an already-pulled first chunk back into the stream while keeping streaming of
 * the rest intact.
 */
async function* withHead<T>(head: readonly T[], iterator: AsyncIterator<T>): AsyncGenerator<T> {
	for (const item of head) {
		yield item
	}
	while (true) {
		const { value, done } = await iterator.next()
		if (done) return
		yield value
	}
}

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	requestTimeoutMs?: number

	openAiApiKey?: string
	openAiBaseUrl?: string
	azureApiVersion?: string
	azureIdentity?: boolean
	openAiHeaders?: Record<string, string>
	openAiModelId?: string
	openAiModelInfo?: OpenAiCompatibleModelInfo
	reasoningEffort?: string
}

export class OpenAiHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined
	private abortController?: AbortController

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	/**
	 * Bound the wait for the first streamed chunk. A gateway that accepts a
	 * request for a model it cannot serve may stall the SSE stream without
	 * emitting a chunk and without erroring. Without a deadline the turn hangs
	 * forever, stranding the foreground turn ("A foreground turn is already
	 * active" on retry). Surfacing the stall as an error lets the task retry or
	 * error out and the session recover.
	 */
	private static readonly DEFAULT_STREAM_START_TIMEOUT_MS = 5 * 60_000

	private async raceFirstChunk<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
		const timeoutMs = this.options.requestTimeoutMs ?? OpenAiHandler.DEFAULT_STREAM_START_TIMEOUT_MS
		if (!timeoutMs || timeoutMs <= 0) {
			return iterator.next()
		}
		let timerFired = false
		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => {
				timerFired = true
				this.abortController?.abort()
				reject(
					new Error(
						`OpenAI-compatible stream timed out waiting for the first chunk after ${timeoutMs}ms. ` +
							`The configured model may not be served by this gateway or the endpoint may be unhealthy.`,
					),
				)
			}, timeoutMs)
		})
		try {
			return await Promise.race([iterator.next(), timeout])
		} finally {
			if (timerFired) {
				this.abortController?.abort()
			}
		}
	}

	private shouldEnableParallelToolCalling(): boolean {
		return isParallelToolCallingEnabled(this.options.enableParallelToolCalling ?? false)
	}

	private getAzureAudienceScope(baseUrl?: string): string {
		const url = baseUrl?.toLowerCase() ?? ""
		if (url.includes("azure.us")) return "https://cognitiveservices.azure.us/.default"
		if (url.includes("azure.com")) return "https://cognitiveservices.azure.com/.default"
		return "https://cognitiveservices.azure.com/.default"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiApiKey && !this.options.azureIdentity) {
				throw new Error("OpenAI API key or Azure Identity Authentication is required")
			}
			try {
				let baseUrl = this.options.openAiBaseUrl?.trim() || ""
				if (baseUrl) {
					// Normalize URL: strip trailing /chat/completions and trailing slashes
					// The OpenAI SDK appends /chat/completions automatically.
					baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, "")
					baseUrl = baseUrl.replace(/\/+$/, "")
				}
				const baseUrlLower = baseUrl.toLowerCase()
				const isAzureDomain = baseUrlLower.includes("azure.com") || baseUrlLower.includes("azure.us")
				const externalHeaders = buildExternalBasicHeaders()
				// Azure API shape slightly differs from the core API shape...
				if (
					this.options.azureApiVersion ||
					(isAzureDomain && !this.options.openAiModelId?.toLowerCase().includes("deepseek"))
				) {
					if (this.options.azureIdentity) {
						this.client = new AzureOpenAI({
							baseURL: baseUrl,
							azureADTokenProvider: getBearerTokenProvider(
								new DefaultAzureCredential(),
								this.getAzureAudienceScope(this.options.openAiBaseUrl),
							),
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: {
								...externalHeaders,
								...this.options.openAiHeaders,
							},
							fetch,
						})
					} else {
						this.client = new AzureOpenAI({
							baseURL: baseUrl,
							apiKey: this.options.openAiApiKey,
							apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
							defaultHeaders: {
								...externalHeaders,
								...this.options.openAiHeaders,
							},
							fetch,
						})
					}
				} else {
					this.client = createOpenAIClient({
						baseURL: baseUrl,
						apiKey: this.options.openAiApiKey,
						defaultHeaders: this.options.openAiHeaders,
					})
				}
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
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
		tools: ChatCompletionTool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const client = this.ensureClient()

		// Add web_search tool for OpenAI
		const finalTools = [...(tools || [])]
		const baseUrl = this.options.openAiBaseUrl?.trim() || ""
		const isOfficialOpenAi = !baseUrl || baseUrl.includes("api.openai.com") || baseUrl.includes("azure.com")
		const isResponsesApi = baseUrl.includes("responses")
		if (isOfficialOpenAi || isResponsesApi) {
			finalTools.push({ type: "web_search" } as any)
		}
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseek = modelId.toLowerCase().includes("deepseek")
		const isR1FormatRequired = this.options.openAiModelInfo?.isR1FormatRequired ?? false
		const isReasoningModelFamily =
			["o1", "o3", "o4", "gpt-5"].some((prefix) => modelId.includes(prefix)) && !modelId.includes("chat")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages, undefined, this.getModel().info.supportsImages !== false),
		]
		let temperature: number | undefined
		if (this.options.openAiModelInfo?.temperature !== undefined) {
			const tempValue = Number(this.options.openAiModelInfo.temperature)
			temperature = tempValue === 0 ? undefined : tempValue
		} else {
			temperature = openAiModelInfoSaneDefaults.temperature
		}
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		let maxTokens: number | undefined

		if (this.options.openAiModelInfo?.maxTokens && this.options.openAiModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.openAiModelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		if (isDeepseek || isR1FormatRequired) {
			const modelInfo = this.getModel().info
			if ((modelInfo as any).supportsTools || (modelInfo as any).isR1FormatRequired) {
				// If the model supports tools or specifically requires R1 format (which includes reasoning_content),
				// we use convertToOpenAiMessages + addReasoningContent to preserve tool calls.
				// convertToR1Format merges messages but loses tools.
				openAiMessages = [
					{ role: "system", content: systemPrompt },
					...addReasoningContent(
						convertToOpenAiMessages(messages, undefined, this.getModel().info.supportsImages !== false),
						messages,
					),
				]
			} else {
				openAiMessages = convertToR1Format(
					[{ role: "user", content: systemPrompt }, ...messages],
					this.getModel().info.supportsImages !== false,
				)
			}
		}

		// "none" is a first-class ReasoningEffort value in the OpenAI SDK, so send it rather than
		// omitting the field: omitting lets the server apply its own default, which for several
		// local backends (Ollama with a qwen3 tag, for one) means reasoning stays ON. Selecting
		// "none" in Settings must actually turn reasoning off.
		reasoningEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort) as ChatCompletionReasoningEffort

		if (isReasoningModelFamily) {
			openAiMessages = [
				{ role: "developer", content: systemPrompt },
				...convertToOpenAiMessages(messages, undefined, this.getModel().info.supportsImages !== false),
			]
			temperature = undefined // does not support temperature
		}

		const stream = await client.chat.completions.create(
			{
				model: modelId,
				messages: openAiMessages,
				temperature,
				max_tokens: maxTokens,
				reasoning_effort: reasoningEffort,
				stream: true,
				stream_options: { include_usage: true },
				...getOpenAIToolParams(finalTools, this.shouldEnableParallelToolCalling()),
			},
			{ signal },
		)

		const toolCallProcessor = new ToolCallProcessor()
		let stopReason: string | undefined

		const streamIterator = stream[Symbol.asyncIterator]()
		const head = await this.raceFirstChunk(streamIterator)
		const seeded = head.done
			? ([] as OpenAI.Chat.Completions.ChatCompletionChunk[])
			: ([head.value] as OpenAI.Chat.Completions.ChatCompletionChunk[])

		for await (const chunk of withHead(seeded, streamIterator)) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.choices?.[0]?.finish_reason) {
				stopReason = chunk.choices[0].finish_reason
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			// Ollama's OpenAI-compatible endpoint streams the thinking trace as `delta.reasoning`,
			// not `reasoning_content`. Matches the openrouter/baseten/wandb/vercel handlers.
			if (delta && "reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				yield {
					...formatOpenAiCompatibleUsage(chunk.usage, this.getModel().info),
					stopReason,
				}
			}
		}
	}

	abort(): void {
		this.abortController?.abort()
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}

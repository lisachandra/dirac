import {
	internationalZAiDefaultModelId,
	internationalZAiModelId,
	internationalZAiModels,
	ModelInfo,
	mainlandZAiDefaultModelId,
	mainlandZAiModelId,
	mainlandZAiModels,
} from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { DiracStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { resolveReasoningEffortForModel } from "@/shared/utils/reasoning-support"
import { version as extensionVersion } from "../../../../package.json"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface ZAiHandlerOptions extends CommonApiHandlerOptions {
	zaiApiLine?: string
	zaiApiKey?: string
	apiModelId?: string
	reasoningEffort?: string
}

export class ZAiHandler implements ApiHandler {
	private options: ZAiHandlerOptions
	private client: OpenAI | undefined
	private abortController: AbortController | undefined
	constructor(options: ZAiHandlerOptions) {
		this.options = options
	}

	private useChinaApi(): boolean {
		return this.options.zaiApiLine === "china"
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.zaiApiKey) {
				throw new Error("Z AI API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: this.useChinaApi() ? "https://open.bigmodel.cn/api/paas/v4" : "https://api.z.ai/api/paas/v4",
					apiKey: this.options.zaiApiKey,
					defaultHeaders: {
						"HTTP-Referer": "https://dirac.run",
						"X-Title": "Dirac",
						"X-Dirac-Version": extensionVersion,
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Z AI client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: mainlandZAiModelId | internationalZAiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (this.useChinaApi()) {
			const id = modelId && modelId in mainlandZAiModels ? (modelId as mainlandZAiModelId) : mainlandZAiDefaultModelId
			return {
				id,
				info: mainlandZAiModels[id],
			}
		}
		const id =
			modelId && modelId in internationalZAiModels ? (modelId as internationalZAiModelId) : internationalZAiDefaultModelId
		return {
			id,
			info: internationalZAiModels[id],
		}
	}

	async *createMessage(systemPrompt: string, messages: DiracStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const abortController = new AbortController()
		this.abortController = abortController
		try {
			yield* this.createMessageWithRetry(systemPrompt, messages, tools, abortController.signal)
		} finally {
			if (this.abortController === abortController) this.abortController = undefined
		}
	}

	@withRetry()
	private async *createMessageWithRetry(
		systemPrompt: string,
		messages: DiracStorageMessage[],
		tools: OpenAITool[] | undefined,
		signal: AbortSignal,
	): ApiStream {
		signal.throwIfAborted()
		const client = this.ensureClient()
		const model = this.getModel()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages, undefined, this.getModel().info.supportsImages !== false),
		]

		const reasoningEffort = resolveReasoningEffortForModel(model.id, model.info, this.options.reasoningEffort)
		const reasoningParams = reasoningEffort
			? {
					thinking: { type: "enabled" },
					reasoning_effort: reasoningEffort,
				}
			: {}
		const stream = (await client.chat.completions.create(
			{
				model: model.id,
				max_tokens: model.info.maxTokens,
				messages: openAiMessages,
				...(model.info.temperature !== undefined ? { temperature: model.info.temperature } : {}),
				stream: true,
				stream_options: { include_usage: true },
				...reasoningParams,
				tool_stream: true,
				...getOpenAIToolParams(tools),
			} as any,
			{ signal },
		)) as unknown as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
				yield {
					type: "usage",
					inputTokens: Math.max(0, (chunk.usage.prompt_tokens || 0) - cacheReadTokens),
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens,
					cacheWriteTokens: 0,
					reasoningTokens: (chunk.usage as any).completion_tokens_details?.reasoning_tokens || 0,
				}
			}
		}
	}

	abort(): void {
		this.abortController?.abort()
	}
}

import { GlobalFileNames } from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import { removeLegacySynthetic1mModelEntries } from "@shared/storage/legacy-model-id-migration"
import type { Controller } from ".."
import { fetchAndCacheModels } from "./fetchAndCacheModels"

type OpenRouterSupportedParam =
	| "frequency_penalty"
	| "include_reasoning"
	| "logit_bias"
	| "logprobs"
	| "max_tokens"
	| "min_p"
	| "parallel_tool_calls"
	| "presence_penalty"
	| "reasoning"
	| "repetition_penalty"
	| "response_format"
	| "seed"
	| "stop"
	| "structured_outputs"
	| "temperature"
	| "tool_choice"
	| "tools"
	| "top_k"
	| "top_logprobs"
	| "top_p"

interface OpenRouterRawModelInfo {
	id: string
	canonical_slug: string
	name: string
	description: string | null
	context_length: number | null
	top_provider: {
		max_completion_tokens: number | null
		context_length: number | null
		is_moderated: boolean | null
	} | null
	architecture: {
		modality: string | string[]
		input_modalities: string[]
		output_modalities: string[]
		tokenizer: string
		instruct_type: string | null
	} | null
	pricing: {
		prompt: string
		completion: string
		request: string
		image: string
		audio: string
		internal_reasoning: string
		input_cache_read: string
		input_cache_write: string
	} | null
	supports_global_endpoint: boolean | null
	tiers: ModelInfo["tiers"] | null
	supported_parameters?: OpenRouterSupportedParam[] | null
}

export async function refreshOpenRouterModels(controller?: Controller): Promise<Record<string, ModelInfo>> {
	return fetchAndCacheModels({
		provider: "openRouter",
		cacheFileName: GlobalFileNames.openRouterModels,
		fetchUrl: "https://openrouter.ai/api/v1/models",
		parseResponse: parseOpenRouterResponse,
		controller,
		readCacheFromController: (ctrl) => ctrl.readOpenRouterModels(),
		postProcess: removeLegacySynthetic1mModelEntries,
	})
}

function parseOpenRouterResponse(rawModels: OpenRouterRawModelInfo[]): Record<string, ModelInfo> {
	const models: Record<string, ModelInfo> = {}
	for (const rawModel of rawModels) {
		const supportedParameters = new Set(rawModel.supported_parameters || [])
		const supportsReasoning = supportedParameters.has("include_reasoning") || supportedParameters.has("reasoning")
		const cacheReadsPrice = parseOpenRouterPrice(rawModel.pricing?.input_cache_read)
		const cacheWritesPrice = parseOpenRouterPrice(rawModel.pricing?.input_cache_write)

		models[rawModel.id] = {
			canonicalSlug: rawModel.canonical_slug,
			name: rawModel.name,
			maxTokens: rawModel.top_provider?.max_completion_tokens ?? undefined,
			contextWindow: rawModel.context_length ?? undefined,
			supportsImages: supportsImageInput(rawModel.architecture),
			supportsPromptCache: cacheReadsPrice !== undefined || cacheWritesPrice !== undefined,
			supportsReasoning,
			supportsReasoningEffort: supportedParameters.has("reasoning"),
			supportsTools: supportedParameters.has("tools"),
			supportsStrictTools: supportedParameters.has("structured_outputs"),
			inputPrice: parseOpenRouterPrice(rawModel.pricing?.prompt),
			outputPrice: parseOpenRouterPrice(rawModel.pricing?.completion),
			cacheWritesPrice,
			cacheReadsPrice,
			description: rawModel.description ?? undefined,
			thinkingConfig: supportsReasoning ? {} : undefined,
			supportsGlobalEndpoint: rawModel.supports_global_endpoint ?? undefined,
			tiers: rawModel.tiers ?? undefined,
		}
	}
	return models
}

function parseOpenRouterPrice(price: string | null | undefined): number | undefined {
	if (price === undefined || price === null || price === "") return undefined
	const parsed = Number.parseFloat(price)
	if (Number.isNaN(parsed)) throw new Error(`OpenRouter returned invalid pricing: ${price}`)
	return parsed * 1_000_000
}

function supportsImageInput(architecture: OpenRouterRawModelInfo["architecture"]): boolean {
	if (!architecture) return false
	if (architecture.input_modalities?.includes("image")) return true
	return architecture.modality.includes("image")
}

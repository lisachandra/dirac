import { MODEL_CAPABILITIES } from "./capabilities"
import type { ModelInfo } from "./types"

export type internationalZAiModelId = keyof typeof internationalZAiModels

export const internationalZAiDefaultModelId: internationalZAiModelId = "glm-5.2"

export const internationalZAiModels = {
	"glm-5.3-flash": {
		...MODEL_CAPABILITIES["glm-5.3-flash"],
		supportsPromptCache: true,
		temperature: 1,
		cacheReadsPrice: 0.03,
		inputPrice: 0.15,
		outputPrice: 0.5,
	},
	"glm-5.3": {
		...MODEL_CAPABILITIES["glm-5.3"],
		supportsPromptCache: true,
		temperature: 1,
		cacheReadsPrice: 0.26,
		inputPrice: 1.4,
		outputPrice: 4.4,
	},
	"glm-5.2": {
		...MODEL_CAPABILITIES["glm-5.2"],
		supportsPromptCache: true,
		cacheReadsPrice: 0.26,
		inputPrice: 1.4,
		outputPrice: 4.4,
	},
	"glm-5.1": {
		...MODEL_CAPABILITIES["glm-5.1"],
		supportsPromptCache: true,
		cacheReadsPrice: 0.26,
		inputPrice: 1.4,
		outputPrice: 4.4,
	},
	"glm-5": {
		...MODEL_CAPABILITIES["glm-5"],
		supportsPromptCache: true,
		cacheReadsPrice: 0.2,
		inputPrice: 1.0,
		outputPrice: 3.2,
	},
} as const satisfies Record<string, ModelInfo>

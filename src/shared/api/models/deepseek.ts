import { MODEL_CAPABILITIES } from "./capabilities"
import type { ModelPricing, OpenAiCompatibleModelInfo } from "./types"

const DEEPSEEK_PEAK_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const

const withDeepSeekPricing = (offPeak: ModelPricing, peak: ModelPricing) => ({
	...offPeak,
	pricingSchedule: {
		timeZone: "UTC" as const,
		defaultLabel: "Off-peak",
		periods: [
			{
				label: "Peak",
				weekdays: DEEPSEEK_PEAK_WEEKDAYS,
				startMinuteUtc: 60,
				endMinuteUtc: 240,
				prices: peak,
			},
			{
				label: "Peak",
				weekdays: DEEPSEEK_PEAK_WEEKDAYS,
				startMinuteUtc: 360,
				endMinuteUtc: 600,
				prices: peak,
			},
		],
	},
})

export const deepSeekModels = {
	"deepseek-flash": {
		...MODEL_CAPABILITIES["deepseek-flash"],
		supportsPromptCache: true,
		...withDeepSeekPricing(
			{ inputPrice: 0, outputPrice: 0.6, cacheWritesPrice: 0.15, cacheReadsPrice: 0.003 },
			{ inputPrice: 0, outputPrice: 1.2, cacheWritesPrice: 0.3, cacheReadsPrice: 0.006 },
		),
	},
	"deepseek-v4-pro": {
		...MODEL_CAPABILITIES["deepseek-v4-pro"],
		supportsPromptCache: true,
		...withDeepSeekPricing(
			{ inputPrice: 0, outputPrice: 1.98, cacheWritesPrice: 0.66, cacheReadsPrice: 0.022 },
			{ inputPrice: 0, outputPrice: 3.96, cacheWritesPrice: 1.32, cacheReadsPrice: 0.044 },
		),
	},
} as const satisfies Record<string, OpenAiCompatibleModelInfo>

export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-flash"

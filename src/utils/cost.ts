import { hasPricing, type ModelInfo, type ModelPricing, type UtcWeekday } from "@shared/api"
import type { InferenceSpeed } from "@shared/storage/types"

const UTC_WEEKDAYS: readonly UtcWeekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

export function getModelPricingForDate(modelInfo: ModelInfo, date: Date = new Date()): ModelPricing {
	const schedule = modelInfo.pricingSchedule
	const weekday = UTC_WEEKDAYS[date.getUTCDay()]
	const minuteUtc = date.getUTCHours() * 60 + date.getUTCMinutes()
	const period = schedule?.periods.find(
		(candidate) =>
			weekday !== undefined &&
			candidate.weekdays.includes(weekday) &&
			minuteUtc >= candidate.startMinuteUtc &&
			minuteUtc < candidate.endMinuteUtc,
	)

	return {
		inputPrice: period?.prices.inputPrice ?? modelInfo.inputPrice,
		outputPrice: period?.prices.outputPrice ?? modelInfo.outputPrice,
		cacheWritesPrice: period?.prices.cacheWritesPrice ?? modelInfo.cacheWritesPrice,
		cacheReadsPrice: period?.prices.cacheReadsPrice ?? modelInfo.cacheReadsPrice,
	}
}
export function getModelInfoForInferenceSpeed(modelInfo: ModelInfo, speed?: InferenceSpeed): ModelInfo {
	const multiplier = speed === "fast" ? modelInfo.fastModePriceMultiplier : undefined
	if (!multiplier || multiplier === 1) return modelInfo
	const scale = (price: number | undefined) => (price === undefined ? undefined : price * multiplier)
	return {
		...modelInfo,
		inputPrice: scale(modelInfo.inputPrice),
		outputPrice: scale(modelInfo.outputPrice),
		cacheWritesPrice: scale(modelInfo.cacheWritesPrice),
		cacheReadsPrice: scale(modelInfo.cacheReadsPrice),
		pricingSchedule: modelInfo.pricingSchedule
			? {
					...modelInfo.pricingSchedule,
					periods: modelInfo.pricingSchedule.periods.map((period) => ({
						...period,
						prices: {
							inputPrice: scale(period.prices.inputPrice),
							outputPrice: scale(period.prices.outputPrice),
							cacheWritesPrice: scale(period.prices.cacheWritesPrice),
							cacheReadsPrice: scale(period.prices.cacheReadsPrice),
						},
					})),
				}
			: undefined,
		tiers: modelInfo.tiers?.map((tier) => ({
			...tier,
			inputPrice: scale(tier.inputPrice),
			outputPrice: scale(tier.outputPrice),
			cacheWritesPrice: scale(tier.cacheWritesPrice),
			cacheReadsPrice: scale(tier.cacheReadsPrice),
		})),
		thinkingConfig: modelInfo.thinkingConfig
			? { ...modelInfo.thinkingConfig, outputPrice: scale(modelInfo.thinkingConfig.outputPrice) }
			: undefined,
	}
}

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number, // Note: For OpenAI-style, this is non-cached tokens. For Anthropic-style, this is total input tokens.
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
	totalInputTokensForPricing: number | undefined, // The *total* input tokens, used for tiered pricing lookup
	thinkingBudgetTokens: number | undefined, // Add thinking budget info
	reasoningTokens: number | undefined,
	pricingDate: Date,
): number | undefined {
	// No pricing data at all → cost is unknown, not zero
	if (!hasPricing(modelInfo)) return undefined

	const usedThinkingBudget = thinkingBudgetTokens && thinkingBudgetTokens > 0

	// Default prices, with any active time-based period applied first.
	const pricing = getModelPricingForDate(modelInfo, pricingDate)
	let effectiveInputPrice = pricing.inputPrice ?? 0
	let effectiveOutputPrice = pricing.outputPrice ?? 0
	let effectiveCacheReadsPrice = pricing.cacheReadsPrice ?? 0
	let effectiveCacheWritesPrice = pricing.cacheWritesPrice ?? 0

	// Handle tiered pricing if available
	if (modelInfo.tiers && modelInfo.tiers.length > 0 && totalInputTokensForPricing !== undefined) {
		// Ensure tiers are sorted by contextWindow ascending before finding
		const sortedTiers = [...modelInfo.tiers].sort((a, b) => a.contextWindow - b.contextWindow)

		// Find the first tier where the total input tokens are less than or equal to the limit
		const tier = sortedTiers.find((t) => totalInputTokensForPricing <= t.contextWindow)

		if (tier) {
			// Apply all tiered price values if they exist
			effectiveInputPrice = tier.inputPrice ?? effectiveInputPrice
			effectiveOutputPrice = tier.outputPrice ?? effectiveOutputPrice
			effectiveCacheReadsPrice = tier.cacheReadsPrice ?? effectiveCacheReadsPrice
			effectiveCacheWritesPrice = tier.cacheWritesPrice ?? effectiveCacheWritesPrice
		} else {
			// Should ideally not happen if Infinity is used for the last tier, but fallback just in case
			const lastTier = sortedTiers[sortedTiers.length - 1]
			if (lastTier) {
				effectiveInputPrice = lastTier.inputPrice ?? effectiveInputPrice
				effectiveOutputPrice = lastTier.outputPrice ?? effectiveOutputPrice
				effectiveCacheReadsPrice = lastTier.cacheReadsPrice ?? effectiveCacheReadsPrice
				effectiveCacheWritesPrice = lastTier.cacheWritesPrice ?? effectiveCacheWritesPrice
			}
		}
	}

	// Override output price for thinking mode if applicable
	if (usedThinkingBudget && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		effectiveOutputPrice = modelInfo.thinkingConfig.outputPrice
		// TODO: Add support for tiered thinking budget output pricing if needed in the future
	}

	const cacheWritesCost = (effectiveCacheWritesPrice / 1_000_000) * cacheCreationInputTokens
	const cacheReadsCost = (effectiveCacheReadsPrice / 1_000_000) * cacheReadInputTokens

	// Use effectiveInputPrice for baseInputCost. Note: 'inputTokens' here is the potentially adjusted count (e.g., non-cached for OpenAI)
	const baseInputCost = (effectiveInputPrice / 1_000_000) * inputTokens

	// Use effectiveOutputPrice for outputCost
	// If reasoningTokens are provided, they are billed at the output rate.
	// In OpenAI/ZAI, completion_tokens (outputTokens) already includes reasoning_tokens.
	const outputCost = (effectiveOutputPrice / 1_000_000) * outputTokens

	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
	return totalCost
}
// For Anthropic compliant usage, the input tokens count does NOT include the cached tokens
export function calculateApiCostAnthropic(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number,
	reasoningTokens?: number,
	pricingDate: Date = new Date(),
): number | undefined {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Anthropic style: inputTokens already represents the total, so pass it directly for tiered pricing lookup if needed
	// (though Anthropic models currently don't use tiered pricing based on input size)
	// Anthropic style doesn't need totalInputTokensForPricing as its inputTokens already represents the total
	return calculateApiCostInternal(
		modelInfo,
		inputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens + cacheCreationInputTokensNum + cacheReadInputTokensNum, // used for tiered price lookup
		thinkingBudgetTokens,
		reasoningTokens,
		pricingDate,
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number, // For OpenAI-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number, // Pass thinking budget info
	reasoningTokens?: number,
	pricingDate: Date = new Date(),
): number | undefined {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
		reasoningTokens,
		pricingDate,
	)
}

// For Qwen compliant usage, follows OpenAI-style token counting where input tokens include cached tokens
export function calculateApiCostQwen(
	modelInfo: ModelInfo,
	inputTokens: number, // For Qwen-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number,
	reasoningTokens?: number,
	pricingDate: Date = new Date(),
): number | undefined {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
		reasoningTokens,
		pricingDate,
	)
}

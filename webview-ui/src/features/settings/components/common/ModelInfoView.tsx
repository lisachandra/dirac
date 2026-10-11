import { geminiModels, type ModelInfo, type ModelPricing, type PricingSchedulePeriod, type UtcWeekday } from "@shared/api"
import { type ReactNode, useState } from "react"
import styled from "styled-components"
import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"
import { formatPrice, hasThinkingBudget, supportsBrowserUse, supportsImages, supportsPromptCache } from "../utils/pricingUtils"

// ========== Styled Components ==========

const InfoRow = styled.div`
	display: flex;
	column-gap: 16px;
	row-gap: 4px;
	font-size: 12px;
	color: var(--vscode-foreground);
	margin-top: 8px;
	flex-wrap: wrap;
`

const InfoItem = styled.span`
	white-space: nowrap;
`

const InfoLabel = styled.span`
	color: var(--vscode-descriptionForeground);
`

const InfoValue = styled.span`
	font-weight: 500;
`

const CollapsibleHeader = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 12px;
	cursor: pointer;
	user-select: none;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--vscode-descriptionForeground);

	&:hover {
		color: var(--vscode-foreground);
	}
`

const CollapsibleArrow = styled.span<{ $isExpanded: boolean }>`
	font-size: 10px;
	transition: transform 0.15s ease;
	transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`

const CollapsibleContent = styled.div<{ $isExpanded: boolean }>`
	max-height: ${({ $isExpanded }) => ($isExpanded ? "800px" : "0")};
	overflow: ${({ $isExpanded }) => ($isExpanded ? "visible" : "hidden")};
	transition: max-height 0.2s ease;
`

const AdvancedSection = styled.div`
	padding-top: 8px;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const AdvancedRow = styled.div`
	display: flex;
	justify-content: space-between;
	padding: 4px 0;
`

const AdvancedLabel = styled.span``

const AdvancedValue = styled.span`
	color: var(--vscode-foreground);
`

// ========== Helper Functions ==========

/**
 * Format price for compact display (e.g., "$5/M" for $5 per million tokens)
 * Price is already in per-million format from OpenRouter
 */
const formatCompactAmount = (price: number): string => {
	if (price === 0) return "$0"
	if (price < 0.01) return `$${price.toFixed(4)}`
	if (price < 0.1) return `$${price.toFixed(3)}`
	if (price < 1) return `$${price.toFixed(2)}`
	return `$${price % 1 === 0 ? price : price.toFixed(2)}`
}

const formatCompactPrice = (price: number | undefined): string => {
	if (price === undefined) return "N/A"
	if (price === 0) return "Free"
	return `${formatCompactAmount(price)}/M`
}

type ModelPriceType = keyof ModelPricing

const getModelPrices = (modelInfo: ModelInfo, priceType: ModelPriceType): number[] => {
	const prices = [modelInfo[priceType]]
	for (const period of modelInfo.pricingSchedule?.periods ?? []) prices.push(period.prices[priceType])
	return prices.filter((price): price is number => price !== undefined)
}

const formatModelPriceRange = (modelInfo: ModelInfo, priceType: ModelPriceType): string => {
	const prices = getModelPrices(modelInfo, priceType)
	if (prices.length === 0) return "N/A"
	const minimum = Math.min(...prices)
	const maximum = Math.max(...prices)
	if (minimum === maximum) return formatCompactPrice(minimum)
	return `${formatCompactAmount(minimum)}–${formatCompactAmount(maximum)}/M`
}

const formatModelPriceDetails = (modelInfo: ModelInfo, priceType: ModelPriceType): string => {
	const basePrice = modelInfo[priceType]
	const schedule = modelInfo.pricingSchedule
	if (basePrice === undefined || !schedule) return formatCompactPrice(basePrice)

	const labeledPrices = new Map<string, number>([[schedule.defaultLabel, basePrice]])
	for (const period of schedule.periods) {
		const price = period.prices[priceType]
		if (price !== undefined) labeledPrices.set(period.label, price)
	}
	return [...labeledPrices].map(([label, price]) => `${label} ${formatCompactPrice(price)}`).join(" · ")
}

const WEEKDAY_LABELS: Record<UtcWeekday, string> = {
	sunday: "Sun",
	monday: "Mon",
	tuesday: "Tue",
	wednesday: "Wed",
	thursday: "Thu",
	friday: "Fri",
	saturday: "Sat",
}

const formatWeekdays = (weekdays: readonly UtcWeekday[]): string => {
	if (weekdays.join(",") === "monday,tuesday,wednesday,thursday,friday") return "Mon–Fri"
	return weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join(", ")
}

const formatUtcMinute = (minute: number): string =>
	`${Math.floor(minute / 60)
		.toString()
		.padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`

const formatPricingPeriod = (period: PricingSchedulePeriod): string =>
	`${formatWeekdays(period.weekdays)}, ${formatUtcMinute(period.startMinuteUtc)}–${formatUtcMinute(period.endMinuteUtc)} UTC`

/**
 * Format context window for compact display (e.g., "200K")
 */
const formatCompactContext = (contextWindow: number | undefined): string => {
	if (!contextWindow) {
		return "N/A"
	}
	if (contextWindow >= 1_000_000) {
		return `${(contextWindow / 1_000_000).toFixed(contextWindow % 1_000_000 === 0 ? 0 : 1)}M`
	}
	return `${Math.round(contextWindow / 1000)}K`
}

/**
 * Returns an array of formatted tier strings
 */
const formatTiers = (
	tiers: ModelInfo["tiers"],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}

	return tiers
		.map((tier, index, arr) => {
			const prevLimit = index > 0 ? arr[index - 1].contextWindow : 0
			const price = tier[priceType]

			if (price === undefined) {
				return null
			}

			return (
				<span key={`tier-${tier.contextWindow}`} style={{ paddingLeft: "15px" }}>
					{formatPrice(price)}/million tokens (
					{tier.contextWindow === Number.POSITIVE_INFINITY || tier.contextWindow >= Number.MAX_SAFE_INTEGER ? (
						<span>
							{">"} {prevLimit.toLocaleString()}
						</span>
					) : (
						<span>
							{"<="} {tier.contextWindow?.toLocaleString()}
						</span>
					)}
					{" tokens)"}
					{index < arr.length - 1 && <br />}
				</span>
			)
		})
		.filter((element): element is JSX.Element => element !== null)
}

// ========== Props ==========

interface ModelInfoViewProps {
	selectedModelId: string
	modelInfo: ModelInfo
	isPopup?: boolean
	advancedContent?: ReactNode
}

// ========== Component ==========

export const ModelInfoView = ({ selectedModelId, modelInfo, isPopup, advancedContent }: ModelInfoViewProps) => {
	const [advancedExpanded, setAdvancedExpanded] = useState(false)

	const isGemini = Object.keys(geminiModels).includes(selectedModelId)
	const hasThinkingConfig = hasThinkingBudget(modelInfo)
	const hasTiers = !!modelInfo.tiers && modelInfo.tiers.length > 0

	// Capability checks
	const hasImages = supportsImages(modelInfo)
	const hasBrowser = supportsBrowserUse(modelInfo)
	const hasCaching = !isGemini && supportsPromptCache(modelInfo)

	// Check if we have cache pricing to show in Advanced section
	const hasCachePricing =
		modelInfo.supportsPromptCache && (modelInfo.cacheWritesPrice !== undefined || modelInfo.cacheReadsPrice !== undefined)
	const hasScheduledCacheMissPricing = modelInfo.pricingSchedule && modelInfo.cacheWritesPrice !== undefined

	return (
		<div style={{ marginTop: 4 }}>
			{/* Description */}
			{modelInfo.description && (
				<ModelDescriptionMarkdown isPopup={isPopup} key="description" markdown={modelInfo.description} />
			)}

			{/* Compact Info Row: Context, Input, Output */}
			<InfoRow>
				{modelInfo.contextWindow !== undefined && modelInfo.contextWindow > 0 && (
					<InfoItem>
						<InfoLabel>Context: </InfoLabel>
						<InfoValue>{formatCompactContext(modelInfo.contextWindow)}</InfoValue>
					</InfoItem>
				)}
				{hasScheduledCacheMissPricing ? (
					<InfoItem>
						<InfoLabel>Cache miss: </InfoLabel>
						<InfoValue>{formatModelPriceRange(modelInfo, "cacheWritesPrice")}</InfoValue>
					</InfoItem>
				) : (
					modelInfo.inputPrice !== undefined && (
						<InfoItem>
							<InfoLabel>Input: </InfoLabel>
							<InfoValue>{formatModelPriceRange(modelInfo, "inputPrice")}</InfoValue>
						</InfoItem>
					)
				)}
				{modelInfo.outputPrice !== undefined && (
					<InfoItem>
						<InfoLabel>Output: </InfoLabel>
						<InfoValue>
							{hasThinkingConfig && modelInfo.thinkingConfig?.outputPrice !== undefined
								? formatCompactPrice(modelInfo.thinkingConfig.outputPrice)
								: formatModelPriceRange(modelInfo, "outputPrice")}
						</InfoValue>
					</InfoItem>
				)}
			</InfoRow>

			{/* Collapsible Advanced Section */}
			<CollapsibleHeader onClick={() => setAdvancedExpanded(!advancedExpanded)}>
				<CollapsibleArrow $isExpanded={advancedExpanded}>▶</CollapsibleArrow>
				Advanced
			</CollapsibleHeader>
			<CollapsibleContent $isExpanded={advancedExpanded}>
				<AdvancedSection>
					{/* Capabilities */}
					<AdvancedRow>
						<AdvancedLabel>Images</AdvancedLabel>
						<AdvancedValue>{hasImages ? "Yes" : "No"}</AdvancedValue>
					</AdvancedRow>
					<AdvancedRow>
						<AdvancedLabel>Browser</AdvancedLabel>
						<AdvancedValue>{hasBrowser ? "Yes" : "No"}</AdvancedValue>
					</AdvancedRow>
					{!isGemini && (
						<AdvancedRow>
							<AdvancedLabel>Prompt Caching</AdvancedLabel>
							<AdvancedValue>{hasCaching ? "Yes" : "No"}</AdvancedValue>
						</AdvancedRow>
					)}

					{/* Cache Pricing */}
					{hasCachePricing && (
						<>
							{modelInfo.cacheReadsPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>{modelInfo.pricingSchedule ? "Cache Hits" : "Cache Reads"}</AdvancedLabel>
									<AdvancedValue>{formatModelPriceDetails(modelInfo, "cacheReadsPrice")}</AdvancedValue>
								</AdvancedRow>
							)}
							{modelInfo.cacheWritesPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>{modelInfo.pricingSchedule ? "Cache Misses" : "Cache Writes"}</AdvancedLabel>
									<AdvancedValue>{formatModelPriceDetails(modelInfo, "cacheWritesPrice")}</AdvancedValue>
								</AdvancedRow>
							)}
						</>
					)}

					{modelInfo.pricingSchedule && (
						<>
							{modelInfo.pricingSchedule.periods.map((period, index) => (
								<AdvancedRow key={`${period.label}-${period.startMinuteUtc}-${index}`}>
									<AdvancedLabel>{period.label}</AdvancedLabel>
									<AdvancedValue>{formatPricingPeriod(period)}</AdvancedValue>
								</AdvancedRow>
							))}
							<AdvancedRow>
								<AdvancedLabel>{modelInfo.pricingSchedule.defaultLabel}</AdvancedLabel>
								<AdvancedValue>All other times</AdvancedValue>
							</AdvancedRow>
						</>
					)}

					{/* Tiered Pricing */}
					{hasTiers && (
						<div style={{ marginTop: 8 }}>
							<div style={{ fontWeight: 500, marginBottom: 4 }}>Tiered Pricing:</div>
							{modelInfo.tiers && (
								<>
									<div>
										<span style={{ fontWeight: 500 }}>Input:</span>
										<br />
										{formatTiers(modelInfo.tiers, "inputPrice")}
									</div>
									<div style={{ marginTop: 4 }}>
										<span style={{ fontWeight: 500 }}>Output:</span>
										<br />
										{formatTiers(modelInfo.tiers, "outputPrice")}
									</div>
								</>
							)}
						</div>
					)}

					{advancedContent}
				</AdvancedSection>
			</CollapsibleContent>
		</div>
	)
}

import { hasPricing, isFreeModel, type ModelInfo } from "@shared/api"

// n/a | Free | $X.XXXX (paid with no usage yet is $0.0000)
export function getCostLabel(totalCost: number, modelInfo?: ModelInfo): string {
	if (totalCost > 0) return `$${totalCost.toFixed(4)}`
	if (!modelInfo || !hasPricing(modelInfo)) return "n/a"
	if (isFreeModel(modelInfo)) return "Free"
	return `$${totalCost.toFixed(4)}`
}

/**
 * Utility to fetch and cache OpenRouter models for the CLI
 */

import type { ModelInfo } from "@shared/api"
import { refreshOpenRouterModels } from "@/core/controller/models/refreshOpenRouterModels"

/**
 * Fetch OpenRouter model metadata through the shared provider catalog.
 */
export function fetchOpenRouterModels(): Promise<Record<string, ModelInfo>> {
	return refreshOpenRouterModels()
}

/**
 * Check if provider uses the OpenRouter model catalog.
 */
export function usesOpenRouterModels(provider: string): boolean {
	return provider === "openrouter"
}

/**
 * Model discovery for OpenAI-compatible endpoints Dirac is pointed at.
 *
 * A base URL that is not OpenAI's or Azure's is a gateway that decides which
 * model ids exist. Its `/models` response is the only authoritative catalog for
 * ACP model pickers; Dirac's static OpenAI ids would advertise models the
 * endpoint rejects and hide the ones it serves.
 */

import type { ApiConfiguration } from "@shared/api"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Mode } from "@/shared/storage/types"

/** Bounded so an unreachable endpoint cannot stall session configuration. */
const ENDPOINT_MODEL_REQUEST_TIMEOUT_MS = 5000

const OFFICIAL_HOST_FRAGMENTS = ["api.openai.com", "azure.com"]
const OPENAI_COMPATIBLE_PROVIDERS = ["openai", "openai-native"]

export interface OpenAiCompatibleEndpoint {
	baseUrl: string
	apiKey?: string
}

/** Providers whose base URL the user may point at a gateway. */
export function isOpenAiCompatibleProvider(provider: string): boolean {
	return OPENAI_COMPATIBLE_PROVIDERS.includes(provider)
}

/**
 * Resolve the custom endpoint for an OpenAI-compatible provider.
 *
 * Returns undefined for official OpenAI/Azure endpoints and for providers that
 * cannot be gateway-backed, in which case the static model ids remain correct.
 */
export function resolveOpenAiCompatibleEndpoint(
	provider: string,
	configuration: ApiConfiguration,
	mode: Mode,
): OpenAiCompatibleEndpoint | undefined {
	if (!isOpenAiCompatibleProvider(provider)) return undefined

	const profileNameKey = mode === "plan" ? "planModeOpenAiProfileName" : "actModeOpenAiProfileName"
	const profileName = configuration[profileNameKey]
	const profile = profileName
		? configuration.openAiCompatibleProfiles?.find((candidate) => candidate.name === profileName)
		: undefined
	const baseUrl = (profile?.baseUrl ?? configuration.openAiBaseUrl)?.trim()
	if (!baseUrl) return undefined
	if (OFFICIAL_HOST_FRAGMENTS.some((fragment) => baseUrl.includes(fragment))) return undefined

	return {
		baseUrl,
		apiKey: profile?.apiKey ?? configuration.openAiCompatibleCustomApiKey ?? configuration.openAiApiKey,
	}
}

/** Fetch the model ids an OpenAI-compatible endpoint serves, or [] when it cannot be read. */
export async function fetchOpenAiCompatibleModelIds(endpoint: OpenAiCompatibleEndpoint): Promise<string[]> {
	const normalizedBaseUrl = normalizeBaseUrl(endpoint.baseUrl)
	if (!normalizedBaseUrl) return []

	try {
		const response = await fetch(`${normalizedBaseUrl}/models`, {
			headers: {
				...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
			},
			signal: AbortSignal.timeout(ENDPOINT_MODEL_REQUEST_TIMEOUT_MS),
		})
		if (!response.ok) {
			Logger.warn(`${normalizedBaseUrl} rejected /models with status ${response.status}`)
			return []
		}
		const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
		const modelIds = (payload.data ?? [])
			.map((entry) => entry.id)
			.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
		return [...new Set(modelIds)].sort((a, b) => a.localeCompare(b))
	} catch (error) {
		Logger.warn(`Could not read models from ${normalizedBaseUrl}:`, error)
		return []
	}
}

/** Extra ids a client may declare through `DIRAC_OPENAI_ADDITIONAL_MODELS`. */
export function declaredAdditionalModelIds(): string[] {
	const declared = process.env.DIRAC_OPENAI_ADDITIONAL_MODELS
	if (!declared) return []
	return declared
		.split(",")
		.map((modelId) => modelId.trim())
		.filter(Boolean)
}

function normalizeBaseUrl(baseUrl: string): string | undefined {
	const withoutRequestPath = baseUrl.replace(/\/+$/, "").replace(/\/(chat\/completions|responses)$/, "")
	if (!URL.canParse(withoutRequestPath)) {
		Logger.warn(`Ignoring unparsable endpoint base URL: ${baseUrl}`)
		return undefined
	}
	return withoutRequestPath
}

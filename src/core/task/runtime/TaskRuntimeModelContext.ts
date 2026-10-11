import type { ApiHandler } from "@core/api"
import type { ResolvedHookModelContext } from "@core/hooks/hook-model-context"
import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import type { TaskWorkingConfiguration } from "./TaskWorkingConfiguration"

/** Resolve hook metadata from the same task-owned configuration as the API handler. */
export function getTaskHookModelContext(
	api: ApiHandler,
	configuration: TaskWorkingConfiguration,
): ResolvedHookModelContext {
	const mode = configuration.settings.mode === "plan" ? "plan" : "act"
	const apiConfiguration = configuration.apiConfiguration
	const provider = (mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider) as
		| ApiProvider
		| undefined
	const genericModelKey = `${mode}ModeApiModelId`
	const providerModelKey = provider ? getProviderModelIdKey(provider, mode) : undefined
	const record = apiConfiguration as Record<string, unknown>
	const providerModelSlug = providerModelKey ? (record[providerModelKey] as string | undefined) : undefined
	const genericModelSlug =
		providerModelKey !== genericModelKey ? (record[genericModelKey] as string | undefined) : undefined
	return {
		provider: provider ?? "unknown",
		slug: providerModelSlug || genericModelSlug || api.getModel().id || "unknown",
	}
}

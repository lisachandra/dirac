import type { ApiHandler } from "@core/api"
import type { ApiProvider } from "@shared/api"
import type { HookModelInputContext } from "./hook-factory"

export type ResolvedHookModelContext = Required<HookModelInputContext>

export interface HookModelSelection {
	providerId?: ApiProvider | string
}

/** Resolve hook metadata from the request-bound handler and provider selection. */
export function getHookModelContext(api: ApiHandler, selection: HookModelSelection): ResolvedHookModelContext {
	return {
		provider: (selection.providerId as ApiProvider | undefined) || "unknown",
		slug: api.getModel().id || "unknown",
	}
}

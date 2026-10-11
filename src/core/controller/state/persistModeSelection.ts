import type { StateManager } from "@core/storage/StateManager"
import type { Mode } from "@shared/storage/types"

/** Persist global and session mode as one compensated state transition. */
export function persistModeSelection(stateManager: StateManager, mode: Mode): void {
	const previousGlobalMode = stateManager.getSystemDefaultSettingsKey("mode")
	const hadSessionMode = stateManager.hasSessionOverride("mode")
	const previousSessionMode = hadSessionMode ? stateManager.getGlobalSettingsKey("mode") : undefined

	try {
		stateManager.setGlobalState("mode", mode)
		stateManager.setSessionOverride("mode", mode)
	} catch (error) {
		try {
			if (hadSessionMode) stateManager.setSessionOverride("mode", previousSessionMode!)
			else stateManager.clearSessionOverride("mode")
			stateManager.setGlobalState("mode", previousGlobalMode)
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "Mode persistence and rollback both failed")
		}
		throw error
	}
}

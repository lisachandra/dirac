import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Controller } from ".."

/** Show terminal profile change notifications for closed and busy terminals */
export function notifyTerminalProfileChange(closedCount: number, busyTerminalsCount: number): void {
	if (closedCount > 0) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Closed ${closedCount} ${closedCount === 1 ? "terminal" : "terminals"} with different profile.`,
		})
	}
	if (busyTerminalsCount > 0) {
		const message = `${busyTerminalsCount} busy ${busyTerminalsCount === 1 ? "terminal has" : "terminals have"} a different profile. Close ${busyTerminalsCount === 1 ? "it" : "them"} to use the new profile for all commands.`
		HostProvider.window.showMessage({ type: ShowMessageType.WARNING, message })
	}
}

export interface TerminalProfileChangeResult {
	closedCount: number
	busyTerminals?: unknown[]
}

/** Apply a profile to the active terminal resource without persistence or notification side effects. */
export function applyDefaultTerminalProfileToActiveTask(
	controller: Controller,
	profileId: string,
): TerminalProfileChangeResult | undefined {
	if (!controller.task) return undefined
	if (!controller.task.terminalManager)
		throw new Error("Cannot update terminal profile: Terminal manager missing from active task")
	return controller.task.terminalManager.setDefaultTerminalProfile(profileId)
}

/** Apply a profile and restore the task resource if the manager fails partway through the change. */
export function applyDefaultTerminalProfileWithRollback(
	controller: Controller,
	profileId: string,
	previousProfileId: string | undefined,
): TerminalProfileChangeResult | undefined {
	try {
		return applyDefaultTerminalProfileToActiveTask(controller, profileId)
	} catch (error) {
		if (!controller.task || previousProfileId === undefined) throw error
		try {
			applyDefaultTerminalProfileToActiveTask(controller, previousProfileId)
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "Terminal profile update and rollback both failed")
		}
		throw error
	}
}

/** Set the persisted default and synchronize the active terminal resource. */
export function setDefaultTerminalProfile(controller: Controller, profileId: string): void {
	controller.stateManager.setGlobalState("defaultTerminalProfile", profileId)
	const result = applyDefaultTerminalProfileToActiveTask(controller, profileId)
	if (result) notifyTerminalProfileChange(result.closedCount, result.busyTerminals?.length ?? 0)
}

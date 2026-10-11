import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { TaskWorkingConfiguration } from "@core/task/runtime/TaskWorkingConfiguration"
import { Empty } from "@shared/proto/dirac/common"
import { AutoApprovalSettingsRequest } from "@shared/proto/dirac/state"
import Mutex from "p-mutex"
import { Controller } from ".."
import { commitWorkingConfigurationUpdate } from "../models/apiConfigurationTransaction"

const autoApprovalSettingsMutex = new Mutex()

function mergeAutoApprovalSettings(current: AutoApprovalSettings, request: AutoApprovalSettingsRequest): AutoApprovalSettings {
	return {
		...structuredClone(current),
		...(request.version !== undefined && { version: request.version }),
		...(request.enableNotifications !== undefined && { enableNotifications: request.enableNotifications }),
		actions: {
			...current.actions,
			...(request.actions
				? Object.fromEntries(Object.entries(request.actions).filter(([, value]) => value !== undefined))
				: {}),
		},
	}
}

/** Update versioned auto-approval defaults and the addressed active Task atomically. */
export async function updateAutoApprovalSettings(controller: Controller, request: AutoApprovalSettingsRequest): Promise<Empty> {
	return autoApprovalSettingsMutex.withLock(async () => {
		const persistedCurrent = (await controller.getStateToPostToWebview()).autoApprovalSettings
		const incomingVersion = request.version
		const currentVersion = persistedCurrent?.version ?? 1
		if (incomingVersion <= currentVersion) return Empty.create()

		const persistedSettings = mergeAutoApprovalSettings(persistedCurrent, request)
		const activeTaskPatch = controller.task
			? (current: TaskWorkingConfiguration) => {
					const currentSettings = current.settings.autoApprovalSettings as AutoApprovalSettings
					if (incomingVersion <= (currentSettings.version ?? 1)) return {}
					return {
						settings: {
							autoApprovalSettings: mergeAutoApprovalSettings(currentSettings, request),
						},
					}
				}
			: undefined

		await commitWorkingConfigurationUpdate(
			controller,
			() => {
				try {
					controller.stateManager.setGlobalState("autoApprovalSettings", persistedSettings)
				} catch (error) {
					try {
						controller.stateManager.setGlobalState("autoApprovalSettings", persistedCurrent)
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], "Auto-approval persistence and rollback both failed")
					}
					throw error
				}
			},
			activeTaskPatch,
		)
		await controller.postStateToWebview()
		return Empty.create()
	})
}

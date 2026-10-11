import { validateApiConfiguration } from "@core/api"
import type { StateManager } from "@core/storage/StateManager"
import type { TaskWorkingConfiguration, TaskWorkingConfigurationPatch } from "@core/task/runtime/TaskWorkingConfiguration"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { persistApiConfigurationPatch } from "./apiConfigurationPersistence"

export type ActiveTaskWorkingConfigurationUpdate =
	| TaskWorkingConfigurationPatch
	| ((current: TaskWorkingConfiguration) => TaskWorkingConfigurationPatch)

export type ApiConfigurationTransactionTask = {
	getWorkingConfiguration(): TaskWorkingConfiguration
	applyWorkingConfigurationUpdate(
		patch: ActiveTaskWorkingConfigurationUpdate,
		beforeCommit?: (candidate: TaskWorkingConfiguration) => void | Promise<void>,
	): Promise<TaskWorkingConfiguration>
}

export type ApiConfigurationTransactionContext = {
	stateManager: StateManager
	task?: ApiConfigurationTransactionTask
}

export type ApiConfigurationPersistence = () => void | Promise<void>

/**
 * Persist an explicit update at the Task's validated commit boundary.
 *
 * For an active Task, candidate construction and API-handler validation happen
 * before `persist`, while the Task transition lock is held. A persistence
 * failure therefore leaves the Task snapshot and runtime unchanged. Once
 * `persist` resolves, the remaining Task commit is synchronous and non-fallible.
 */
export async function commitWorkingConfigurationUpdate(
	controller: ApiConfigurationTransactionContext,
	persist: ApiConfigurationPersistence,
	activeTaskPatch?: ActiveTaskWorkingConfigurationUpdate,
): Promise<void> {
	if (controller.task && activeTaskPatch) {
		await controller.task.applyWorkingConfigurationUpdate(activeTaskPatch, persist)
		return
	}
	await persist()
}

/**
 * Validate, persist, and install an API configuration in release-safe order.
 *
 * `activeConfigurationPatch` contains only fields explicitly addressed by the
 * operation. The complete `configuration` remains the persistence candidate
 * and validates default-only updates when no active Task owns a snapshot.
 */
export async function applyApiConfigurationTransaction(
	controller: ApiConfigurationTransactionContext,
	configuration: ApiConfiguration,
	persist: ApiConfigurationPersistence = () => persistApiConfigurationPatch(controller.stateManager, configuration),
	mode?: Mode,
	activeConfigurationPatch: Partial<ApiConfiguration> = configuration,
): Promise<void> {
	const activeTaskPatch: TaskWorkingConfigurationPatch = {
		apiConfiguration: activeConfigurationPatch,
		...(mode === undefined ? {} : { settings: { mode } }),
	}

	if (!controller.task) {
		validateApiConfiguration(configuration, mode ?? controller.stateManager.getGlobalSettingsKey("mode"))
	} else {
		const current = controller.task.getWorkingConfiguration()
		validateApiConfiguration(
			{ ...current.apiConfiguration, ...activeConfigurationPatch } as ApiConfiguration,
			mode ?? current.settings.mode,
		)
	}

	await commitWorkingConfigurationUpdate(controller, persist, controller.task ? activeTaskPatch : undefined)
}

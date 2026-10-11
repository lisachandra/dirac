import type { Controller } from "@/core/controller"
import type { TaskWorkingConfigurationPatch } from "@/core/task/runtime/TaskWorkingConfiguration"

/**
 * Apply one interactive settings operation at the active Task's validated
 * commit boundary. Without an active Task, the operation updates defaults only.
 */
export async function commitInteractiveSetting(
	controller: Controller | undefined,
	patch: TaskWorkingConfigurationPatch,
	persist: () => void | Promise<void>,
): Promise<void> {
	if (controller?.task) await controller.task.applyWorkingConfigurationUpdate(patch, persist)
	else await persist()
	await controller?.postStateToWebview()
}

/** Restore the explicitly addressed persistence state if a durable write fails. */
export async function persistInteractiveSettingWithRollback(
	persist: () => void | Promise<void>,
	rollback: () => void | Promise<void>,
): Promise<void> {
	try {
		await persist()
	} catch (error) {
		try {
			await rollback()
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "Settings persistence and rollback both failed")
		}
		throw error
	}
}

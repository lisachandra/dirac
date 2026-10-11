import { GoalStore } from "@core/goal/GoalStore"
import { deleteTaskDirectory, getTasksDirectoryPath, listTaskDirectoryIds } from "@core/storage/disk"
import { isGoalHistoryItem, type RunHistoryItem } from "@shared/HistoryItem"
import { DeleteAllTaskHistoryCount } from "@shared/proto/dirac/task"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getErrorMessage } from "@/shared/errors"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { withTaskHistoryInventoryLock } from "@core/storage/taskHistory"
import { fileExistsAtPath } from "../../../utils/fs"
import { Controller } from ".."

/**
 * Deletes all task history, with an option to preserve favorites
 * @param controller The controller instance
 * @returns Results with count of deleted tasks
 */
export async function deleteAllTaskHistory(controller: Controller): Promise<DeleteAllTaskHistoryCount> {
	try {
		const initialTaskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const userChoice = (
			await HostProvider.window.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message: "What would you like to delete?",
					options: {
						modal: true,
						items: ["Delete All Except Favorites", "Delete Everything"],
					},
				}),
			)
		).selectedOption

		if (userChoice === undefined) {
			return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
		}

		const preserveFavorites = userChoice === "Delete All Except Favorites"
		let deleteEverythingConfirmed = userChoice === "Delete Everything"
		if (preserveFavorites && !initialTaskHistory.some((task) => task.isFavorited === true)) {
			deleteEverythingConfirmed = await confirmDeleteAllTasks()
			if (!deleteEverythingConfirmed) {
				return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
			}
		}

		return withTaskHistoryInventoryLock(async () => {
			await controller.clearTask()
			const currentTaskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
			const totalTasks = currentTaskHistory.length

			if (preserveFavorites) {
				const favoritedTasks = currentTaskHistory.filter((task) => task.isFavorited === true)
				if (favoritedTasks.length > 0) {
					await cleanupRunFiles(favoritedTasks)
					controller.stateManager.replaceTaskHistory(favoritedTasks)
					await controller.stateManager.flushPendingState()

					try {
						await controller.postStateToWebview()
					} catch (webviewErr) {
						Logger.error("Error posting to webview:", webviewErr)
					}

					return DeleteAllTaskHistoryCount.create({
						tasksDeleted: totalTasks - favoritedTasks.length,
					})
				}
				if (!deleteEverythingConfirmed && !(await confirmDeleteAllTasks())) {
					await controller.postStateToWebview()
					return DeleteAllTaskHistoryCount.create({ tasksDeleted: 0 })
				}
			}

			try {
				const taskDirPath = getTasksDirectoryPath()
				if (await fileExistsAtPath(taskDirPath)) {
					await fs.rm(taskDirPath, { recursive: true, force: true })
				}

				const checkpointsDirPath = path.join(HostProvider.get().globalStorageFsPath, "checkpoints")
				if (await fileExistsAtPath(checkpointsDirPath)) {
					await fs.rm(checkpointsDirPath, { recursive: true, force: true })
				}
			} catch (error) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Encountered error while deleting task history, there may be some files left behind. Error: ${getErrorMessage(error)}`,
				})
				throw error
			}
			controller.stateManager.replaceTaskHistory([])
			await controller.stateManager.flushPendingState()

			try {
				await controller.postStateToWebview()
			} catch (webviewErr) {
				Logger.error("Error posting to webview:", webviewErr)
			}

			return DeleteAllTaskHistoryCount.create({ tasksDeleted: totalTasks })
		})
	} catch (error) {
		Logger.error("Error in deleteAllTaskHistory:", error)
		throw error
	}
}

async function confirmDeleteAllTasks(): Promise<boolean> {
	const answer = (
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "No favorited tasks found. Would you like to delete all tasks anyway?",
			options: {
				modal: true,
				items: ["Delete All Tasks"],
			},
		})
	).selectedOption

	return answer === "Delete All Tasks"
}

/**
 * Helper function to cleanup task files while preserving specified tasks
 */
async function cleanupRunFiles(preservedItems: RunHistoryItem[]): Promise<void> {
	const preservedDirectoryIds = new Set(preservedItems.map((item) => item.id))
	const goalStore = new GoalStore()
	for (const item of preservedItems) {
		if (!isGoalHistoryItem(item)) continue
		const goal = await goalStore.read(item.id)
		for (const child of goal.children) preservedDirectoryIds.add(child.id)
	}

	const taskDirectoryIds = await listTaskDirectoryIds()
	Logger.debug(`[cleanupRunFiles] Found ${taskDirectoryIds.length} task directories`)
	await Promise.all(taskDirectoryIds.filter((id) => !preservedDirectoryIds.has(id)).map((id) => deleteTaskDirectory(id)))
}

import { Empty } from "@shared/proto/dirac/common"
import { TaskFavoriteRequest } from "@shared/proto/dirac/task"
import { Controller } from "../"

export async function toggleTaskFavorite(controller: Controller, request: TaskFavoriteRequest): Promise<Empty> {
	if (!request.taskId) {
		throw new Error("[toggleTaskFavorite] Missing task ID")
	}

	const history = controller.stateManager.getGlobalStateKey("taskHistory")
	const taskIndex = history.findIndex((item) => item.id === request.taskId)
	if (taskIndex === -1) {
		throw new Error(`[toggleTaskFavorite] Task ${request.taskId} was not found`)
	}

	controller.stateManager.setTaskHistoryFavorite(request.taskId, request.isFavorited)
	await controller.stateManager.flushPendingState()

	await controller.postStateToWebview()
	return Empty.create({})
}

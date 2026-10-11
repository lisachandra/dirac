import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalControlRequest } from "@shared/proto/dirac/goal"

export async function pauseGoal(controller: Controller, request: GoalControlRequest): Promise<Empty> {
	await controller.pauseGoal(request.goalId, request.reason)
	return Empty.create()
}

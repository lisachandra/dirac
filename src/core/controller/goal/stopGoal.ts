import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalControlRequest } from "@shared/proto/dirac/goal"

export async function stopGoal(controller: Controller, request: GoalControlRequest): Promise<Empty> {
	await controller.stopGoal(request.goalId, request.reason)
	return Empty.create()
}

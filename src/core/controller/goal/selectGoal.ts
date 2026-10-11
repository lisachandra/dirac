import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalControlRequest } from "@shared/proto/dirac/goal"

export async function selectGoal(controller: Controller, request: GoalControlRequest): Promise<Empty> {
	await controller.selectGoal(request.goalId)
	return Empty.create()
}

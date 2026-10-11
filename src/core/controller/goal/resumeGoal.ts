import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalControlRequest } from "@shared/proto/dirac/goal"

export async function resumeGoal(controller: Controller, request: GoalControlRequest): Promise<Empty> {
	await controller.resumeGoal(request.goalId)
	return Empty.create()
}

import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalSteerRequest } from "@shared/proto/dirac/goal"

export async function steerGoal(controller: Controller, request: GoalSteerRequest): Promise<Empty> {
	await controller.steerGoal(request.goalId, request.message)
	return Empty.create()
}

import type { Controller } from "@core/controller"
import { Empty } from "@shared/proto/dirac/common"
import type { GoalMessageRequest } from "@shared/proto/dirac/goal"

export async function sendGoalMessage(controller: Controller, request: GoalMessageRequest): Promise<Empty> {
	await controller.sendGoalMessage(request.goalId, request.message)
	return Empty.create()
}

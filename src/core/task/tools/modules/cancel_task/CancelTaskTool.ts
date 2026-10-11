import type { DiracToolSpec } from "@shared/tools"
import {
	goalToolJson,
	optionalNonEmptyString,
	requireArguments,
	requireGoalTrait,
	requireNonEmptyString,
} from "../../goal/GoalToolInput"
import {
	goalTaskCardBody,
	goalTaskCardOutput,
	pendingGoalTaskCardBody,
	runGoalTaskActionCard,
} from "../../goal/GoalTaskActionCard"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const cancel_task_spec: DiracToolSpec = {
	id: "cancel_task",
	name: "cancel_task",
	description: "Cancel a contained Task and wait for its teardown.",
	parameters: [
		{
			name: "task_id",
			required: true,
			instruction: "Stable contained Task ID.",
			minLength: 1,
		},
		{
			name: "reason",
			required: false,
			instruction: "Optional non-empty reason for cancelling the contained Task.",
			minLength: 1,
		},
	],
}

export class CancelTaskTool implements IDiracTool {
	spec(): DiracToolSpec {
		return cancel_task_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const taskId = requireNonEmptyString(args, "task_id")
		const reason = optionalNonEmptyString(args, "reason")
		const goal = requireGoalTrait(environment)
		const detail = { label: "Reason", markdown: reason ?? "No reason provided." }
		const task = await runGoalTaskActionCard(environment, {
			initial: {
				header: `Cancelling task: ${taskId}`,
				body: pendingGoalTaskCardBody(taskId, detail),
				rawInput: { task_id: taskId, ...(reason === undefined ? {} : { reason }) },
			},
			failureHeader: `Failed to cancel task: ${taskId}`,
			operation: () => goal.cancelTask({ taskId, reason }),
			completed: (record) => ({
				header:
					record.status === "cancelled"
						? `Cancelled task: ${record.title}`
						: `Task already ${record.status}: ${record.title}`,
				body: goalTaskCardBody(record, detail),
				rawOutput: goalTaskCardOutput(record),
			}),
		})
		return goalToolJson(task)
	}
}

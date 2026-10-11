import type { DiracToolSpec } from "@shared/tools"
import { requireArguments, requireGoalTrait, requireNonEmptyString } from "../../goal/GoalToolInput"
import {
	goalTaskCardBody,
	goalTaskCardOutput,
	pendingGoalTaskCardBody,
	runGoalTaskActionCard,
} from "../../goal/GoalTaskActionCard"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const send_task_message_spec: DiracToolSpec = {
	id: "send_task_message",
	name: "send_task_message",
	description: "Queue private steering for a live contained Task.",
	parameters: [
		{
			name: "task_id",
			required: true,
			instruction: "Stable contained Task ID.",
			minLength: 1,
		},
		{
			name: "message",
			required: true,
			instruction: "Guidance to queue for the contained Task at its next safe request boundary.",
			minLength: 1,
		},
	],
}

export class SendTaskMessageTool implements IDiracTool {
	spec(): DiracToolSpec {
		return send_task_message_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const taskId = requireNonEmptyString(args, "task_id")
		const message = requireNonEmptyString(args, "message")
		const goal = requireGoalTrait(environment)
		await runGoalTaskActionCard(environment, {
			initial: {
				header: `Messaging task: ${taskId}`,
				body: pendingGoalTaskCardBody(taskId, { label: "Message", markdown: message }),
				rawInput: { task_id: taskId, message },
			},
			failureHeader: `Failed to message task: ${taskId}`,
			operation: () => goal.sendTaskMessage({ taskId, message }),
			completed: (record) => ({
				header: `Messaged task: ${record.title}`,
				body: goalTaskCardBody(record, { label: "Message", markdown: message }),
				rawOutput: goalTaskCardOutput(record),
			}),
		})
		return `Message queued for contained Task '${taskId}'.`
	}
}

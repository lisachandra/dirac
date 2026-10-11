import type { DiracToolSpec } from "@shared/tools"
import { goalToolJson, requireArguments, requireGoalTrait, requireNonEmptyString } from "../../goal/GoalToolInput"
import {
	goalTaskCardBody,
	goalTaskCardOutput,
	pendingGoalTaskCardBody,
	runGoalTaskActionCard,
} from "../../goal/GoalTaskActionCard"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const start_task_spec: DiracToolSpec = {
	id: "start_task",
	name: "start_task",
	description: "Start a private contained Task for this Goal.",
	parameters: [
		{
			name: "task_title",
			required: true,
			instruction: "Short title identifying the contained Task.",
			minLength: 1,
		},
		{
			name: "prompt",
			required: true,
			instruction: "Complete, self-contained assignment for the contained Task.",
			minLength: 1,
		},
	],
}

export class StartTaskTool implements IDiracTool {
	spec(): DiracToolSpec {
		return start_task_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const taskTitle = requireNonEmptyString(args, "task_title")
		const prompt = requireNonEmptyString(args, "prompt")
		const goal = requireGoalTrait(environment)
		const task = await runGoalTaskActionCard(environment, {
			initial: {
				header: `Starting task: ${taskTitle}`,
				body: pendingGoalTaskCardBody(taskTitle, { label: "Assignment", markdown: prompt }),
				rawInput: { task_title: taskTitle, prompt },
			},
			failureHeader: `Failed to start task: ${taskTitle}`,
			operation: () => goal.startTask({ taskTitle, prompt }),
			completed: (record) => ({
				header: `Started task: ${record.title}`,
				body: goalTaskCardBody(record, { label: "Assignment", markdown: prompt }),
				rawOutput: goalTaskCardOutput(record),
			}),
		})
		return goalToolJson(task)
	}
}

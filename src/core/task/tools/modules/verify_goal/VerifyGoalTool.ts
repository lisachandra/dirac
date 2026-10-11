import type { DiracToolSpec } from "@shared/tools"
import { goalToolJson, optionalNonEmptyString, requireArguments, requireGoalTrait } from "../../goal/GoalToolInput"
import {
	goalTaskCardBody,
	goalTaskCardOutput,
	pendingGoalTaskCardBody,
	runGoalTaskActionCard,
} from "../../goal/GoalTaskActionCard"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const verify_goal_spec: DiracToolSpec = {
	id: "verify_goal",
	name: "verify_goal",
	description: "Start an asynchronous verification Task for the current Goal.",
	parameters: [
		{
			name: "focus",
			required: false,
			instruction: "Optional non-empty focus for the verification Task.",
			minLength: 1,
		},
	],
}

export class VerifyGoalTool implements IDiracTool {
	spec(): DiracToolSpec {
		return verify_goal_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const focus = optionalNonEmptyString(args, "focus")
		const goal = requireGoalTrait(environment)
		const focusText = focus ?? "Full Goal verification"
		const task = await runGoalTaskActionCard(environment, {
			initial: {
				header: "Starting Goal verification",
				body: pendingGoalTaskCardBody("Verification", { label: "Focus", markdown: focusText }),
				rawInput: focus === undefined ? {} : { focus },
			},
			failureHeader: "Failed to start Goal verification",
			operation: () => goal.startVerification({ focus }),
			completed: (record) => ({
				header: `Started verification: ${record.title}`,
				body: goalTaskCardBody(record, { label: "Focus", markdown: focusText }),
				rawOutput: goalTaskCardOutput(record),
			}),
		})
		return goalToolJson(task)
	}
}

import type { DiracToolSpec } from "@shared/tools"
import { requireArguments, requireGoalTrait, requireNonEmptyString } from "../../goal/GoalToolInput"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const block_goal_spec: DiracToolSpec = {
	id: "block_goal",
	name: "block_goal",
	description: "Declare this Goal blocked after all contained Tasks are terminal.",
	parameters: [
		{
			name: "reason",
			required: true,
			instruction: "Non-empty explanation of the obstacle preventing autonomous progress.",
			minLength: 1,
		},
	],
}

export class BlockGoalTool implements IDiracTool {
	spec(): DiracToolSpec {
		return block_goal_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const reason = requireNonEmptyString(args, "reason")
		await requireGoalTrait(environment).blockGoal(reason)
		return `Goal blocked: ${reason}`
	}
}

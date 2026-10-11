import type { DiracToolSpec } from "@shared/tools"
import { goalToolJson, requireArguments, requireGoalTrait, requireNonEmptyString } from "../../goal/GoalToolInput"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const update_goal_spec: DiracToolSpec = {
	id: "update_goal",
	name: "update_goal",
	description: "Atomically replace this Goal's durable objective Markdown.",
	parameters: [
		{
			name: "objective_markdown",
			required: true,
			instruction: "Complete freely structured Markdown that replaces the current durable objective.",
			minLength: 1,
		},
	],
}

export class UpdateGoalTool implements IDiracTool {
	spec(): DiracToolSpec {
		return update_goal_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const objectiveMarkdown = requireNonEmptyString(args, "objective_markdown")
		return goalToolJson(await requireGoalTrait(environment).replaceObjective(objectiveMarkdown))
	}
}

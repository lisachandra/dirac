import type { DiracToolSpec } from "@shared/tools"
import {
	boundedLimit,
	goalToolJson,
	optionalGoalChildRole,
	optionalGoalChildStatuses,
	optionalNonEmptyString,
	requireArguments,
	requireGoalTrait,
} from "../../goal/GoalToolInput"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { ToolExecutionDeadline, ToolTimeoutError } from "../../runtime/ToolExecutionDeadline"
import { presentToolTimeout } from "../../runtime/ToolTimeoutPresentation"

const DEFAULT_TASK_LIMIT = 20
const MAXIMUM_TASK_LIMIT = 100

export const list_tasks_spec: DiracToolSpec = {
	id: "list_tasks",
	name: "list_tasks",
	description: "List current or historical contained Tasks owned by this Goal.",
	parameters: [
		{
			name: "status",
			type: "array",
			required: false,
			instruction: "Optional statuses to include.",
			items: {
				type: "string",
				enum: ["starting", "running", "waiting", "completed", "failed", "cancelled", "interrupted"],
			},
		},
		{
			name: "role",
			required: false,
			instruction: "Optional contained Task role to include.",
			enum: ["task", "verification"],
		},
		{
			name: "cursor",
			required: false,
			instruction: "Opaque cursor returned by an earlier list_tasks call.",
		},
		{
			name: "limit",
			type: "integer",
			required: false,
			instruction: `Page size. Defaults to ${DEFAULT_TASK_LIMIT}; maximum ${MAXIMUM_TASK_LIMIT}.`,
			minimum: 1,
			maximum: MAXIMUM_TASK_LIMIT,
		},
	],
}

export class ListTasksTool implements IDiracTool {
	spec(): DiracToolSpec {
		return list_tasks_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const status = optionalGoalChildStatuses(args)
		const role = optionalGoalChildRole(args)
		const cursor = optionalNonEmptyString(args, "cursor")
		const limit = boundedLimit(args, DEFAULT_TASK_LIMIT, MAXIMUM_TASK_LIMIT)
		const deadline = new ToolExecutionDeadline(this.spec().name)
		try {
			const result = await deadline.run("listing contained tasks", async () =>
				await requireGoalTrait(environment).listTasks({ status, role, cursor, limit }))
			return goalToolJson(result)
		} catch (error) {
			if (error instanceof ToolTimeoutError) return await presentToolTimeout(environment, error)
			throw error
		}
	}
}

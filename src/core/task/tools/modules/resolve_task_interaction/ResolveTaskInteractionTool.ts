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

type InteractionResolution = "allow" | "reject" | "answer" | "passthrough"

const INTERACTION_RESOLUTIONS: readonly InteractionResolution[] = ["allow", "reject", "answer", "passthrough"]

export const resolve_task_interaction_spec: DiracToolSpec = {
	id: "resolve_task_interaction",
	name: "resolve_task_interaction",
	description: "Resolve one pending contained Task interaction directly or pass it through to the user.",
	parameters: [
		{
			name: "task_id",
			required: true,
			instruction: "Stable contained Task ID.",
			minLength: 1,
		},
		{
			name: "interaction_id",
			required: true,
			instruction: "Stable pending interaction ID.",
			minLength: 1,
		},
		{
			name: "resolution",
			required: true,
			instruction: "How to resolve the pending interaction.",
			enum: INTERACTION_RESOLUTIONS,
		},
		{
			name: "answer",
			required: false,
			instruction: "Required non-empty answer text when resolution is 'answer'; omit for every other resolution.",
			minLength: 1,
		},
	],
}

export class ResolveTaskInteractionTool implements IDiracTool {
	spec(): DiracToolSpec {
		return resolve_task_interaction_spec
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(input: unknown, environment: IToolEnvironment): Promise<string> {
		const args = requireArguments(input)
		const taskId = requireNonEmptyString(args, "task_id")
		const interactionId = requireNonEmptyString(args, "interaction_id")
		const resolution = this.requireResolution(args.resolution)
		const answer = this.resolveAnswer(args.answer, resolution)
		const goal = requireGoalTrait(environment)
		if (resolution === "passthrough") {
			const result = await goal.resolveTaskInteraction({ taskId, interactionId, resolution })
			return goalToolJson({ resolved: result.resolved })
		}

		const resolutionMarkdown = [
			`**Interaction ID:** \`${interactionId}\``,
			`**Resolution:** ${resolution}`,
			...(answer === undefined ? [] : ["", "**Answer:**", answer]),
		].join("\n")
		const result = await runGoalTaskActionCard(environment, {
			initial: {
				header: `Resolving task interaction: ${taskId}`,
				body: pendingGoalTaskCardBody(taskId, { label: "Interaction", markdown: resolutionMarkdown }),
				rawInput: {
					task_id: taskId,
					interaction_id: interactionId,
					resolution,
					...(answer === undefined ? {} : { answer }),
				},
			},
			failureHeader: `Failed to resolve task interaction: ${taskId}`,
			operation: () => goal.resolveTaskInteraction({ taskId, interactionId, resolution, answer }),
			completed: ({ task }) => ({
				header: `Resolved task interaction: ${task.title}`,
				body: goalTaskCardBody(task, { label: "Interaction", markdown: resolutionMarkdown }),
				rawOutput: { resolved: true, task: goalTaskCardOutput(task) },
			}),
		})
		return goalToolJson({ resolved: result.resolved })
	}

	private requireResolution(value: unknown): InteractionResolution {
		if (typeof value !== "string" || !INTERACTION_RESOLUTIONS.includes(value as InteractionResolution)) {
			throw new Error("Parameter 'resolution' must be 'allow', 'reject', 'answer', or 'passthrough'.")
		}
		return value as InteractionResolution
	}

	private resolveAnswer(value: unknown, resolution: InteractionResolution): string | undefined {
		if (resolution === "answer") {
			if (typeof value !== "string" || value.trim().length === 0) {
				throw new Error("Parameter 'answer' must be a non-empty string when resolution is 'answer'.")
			}
			return value
		}
		if (value !== undefined) throw new Error("Parameter 'answer' is valid only when resolution is 'answer'.")
		return undefined
	}
}

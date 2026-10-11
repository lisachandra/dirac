import type { DiracToolSpec } from "@shared/tools"
import { GOAL_COORDINATOR_TOOL_EXPOSURE, type ToolExposure } from "../../discovery/DiscoveredTool"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { ResolveTaskInteractionTool, resolve_task_interaction_spec } from "./ResolveTaskInteractionTool"

export const spec: DiracToolSpec = resolve_task_interaction_spec
export const exposure: ToolExposure = GOAL_COORDINATOR_TOOL_EXPOSURE

export function create(): IDiracTool {
	return new ResolveTaskInteractionTool()
}

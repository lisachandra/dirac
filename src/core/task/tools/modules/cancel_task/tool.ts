import type { DiracToolSpec } from "@shared/tools"
import { GOAL_COORDINATOR_TOOL_EXPOSURE, type ToolExposure } from "../../discovery/DiscoveredTool"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { CancelTaskTool, cancel_task_spec } from "./CancelTaskTool"

export const spec: DiracToolSpec = cancel_task_spec
export const exposure: ToolExposure = GOAL_COORDINATOR_TOOL_EXPOSURE

export function create(): IDiracTool {
	return new CancelTaskTool()
}

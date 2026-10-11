import type { DiracToolSpec } from "@shared/tools"
import { GOAL_COORDINATOR_TOOL_EXPOSURE, type ToolExposure } from "../../discovery/DiscoveredTool"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { BlockGoalTool, block_goal_spec } from "./BlockGoalTool"

export const spec: DiracToolSpec = block_goal_spec
export const exposure: ToolExposure = GOAL_COORDINATOR_TOOL_EXPOSURE

export function create(): IDiracTool {
	return new BlockGoalTool()
}

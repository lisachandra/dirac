import type { DiracToolSpec } from "@shared/tools"
import { GOAL_COORDINATOR_TOOL_EXPOSURE, type ToolExposure } from "../../discovery/DiscoveredTool"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { WaitForGoalEventsTool, wait_for_goal_events_spec } from "./WaitForGoalEventsTool"

export const spec: DiracToolSpec = wait_for_goal_events_spec
export const exposure: ToolExposure = GOAL_COORDINATOR_TOOL_EXPOSURE

export function create(): IDiracTool {
	return new WaitForGoalEventsTool()
}

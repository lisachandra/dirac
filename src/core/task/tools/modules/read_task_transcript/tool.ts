import type { DiracToolSpec } from "@shared/tools"
import { GOAL_COORDINATOR_TOOL_EXPOSURE, type ToolExposure } from "../../discovery/DiscoveredTool"
import type { IDiracTool } from "../../interfaces/IDiracTool"
import { ReadTaskTranscriptTool, read_task_transcript_spec } from "./ReadTaskTranscriptTool"

export const spec: DiracToolSpec = read_task_transcript_spec
export const exposure: ToolExposure = GOAL_COORDINATOR_TOOL_EXPOSURE

export function create(): IDiracTool {
	return new ReadTaskTranscriptTool()
}

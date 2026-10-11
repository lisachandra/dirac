import { DiracTextContentBlock, DiracUserToolResultContentBlock } from "@shared/messages/content"
import type { ToolUse } from "../../../assistant-message"
import type { ToolResponse } from "../.."
import type { TaskState } from "../../TaskState"

// Converts tool response content into tool_result blocks and pushes to user message content.
export class ToolResultPusher {
	constructor(private taskState: TaskState) { }

	async pushToolResult(content: ToolResponse, block: ToolUse): Promise<void> {
		const toolUseId = block.id || block.call_id || ""
		const toolResult: DiracUserToolResultContentBlock = {
			type: "tool_result",
			tool_use_id: toolUseId,
			content,
		}
		this.taskState.userMessageContent.push(toolResult)
	}

	// Appends a warning to the tool result if the tool call count exceeds 50.
	static appendLoopWarning(toolResult: any, count: number): any {
		if (count < 50 || (count - 50) % 25 !== 0) return toolResult
		const warning = `\n\n[SYSTEM NOTE: You have executed ${count} tool calls. Ensure you are making progress. If finished, call respond with operation "complete"; if stuck, change approach.]`
		if (typeof toolResult === "string") return toolResult + warning
		if (Array.isArray(toolResult)) {
			const lastBlock = toolResult[toolResult.length - 1]
			if (lastBlock?.type === "text") lastBlock.text += warning
			else toolResult.push({ type: "text", text: warning } as DiracTextContentBlock)
		}
		return toolResult
	}
}

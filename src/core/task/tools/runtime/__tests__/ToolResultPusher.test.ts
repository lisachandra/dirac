import "should"
import { TaskState } from "../../../TaskState"
import { ToolResultPusher } from "../ToolResultPusher"

describe("ToolResultPusher", () => {
	it("stores mixed text and image output as one atomic tool result", async () => {
		const taskState = new TaskState()
		const pusher = new ToolResultPusher(taskState)

		await pusher.pushToolResult(
			[
				{ type: "text", text: "Successfully read image" },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: "BASE64_SENTINEL" },
				},
			] as any,
			{ id: "tool_call_1", name: "read_file", input: {} } as any,
		)

		taskState.userMessageContent.should.deepEqual([
			{
				type: "tool_result",
				tool_use_id: "tool_call_1",
				content: [
					{ type: "text", text: "Successfully read image" },
					{
						type: "image",
						source: { type: "base64", media_type: "image/png", data: "BASE64_SENTINEL" },
					},
				],
			},
		])
	})
})

import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import { createEmptySubagentRunStats } from "../SubagentRunHelpers"
import { SubagentToolExecutor } from "../SubagentToolExecutor"

describe("SubagentToolExecutor", () => {
	it("keeps multimodal tool results structured while sanitizing observer output", async () => {
		const multimodalResult = [
			{ type: "text", text: "image contents" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64_IMAGE" } },
		] as any
		const coordinator = {
			has: sinon.stub().returns(true),
			execute: sinon.stub().resolves(multimodalResult),
		}
		const recordToolResult = sinon.spy()
		const executor = new SubagentToolExecutor(
			() => ({ coordinator } as any),
			() => true,
			{
				recordToolCall: sinon.spy(),
				recordToolResult,
				recordProgress: sinon.spy(),
				markActivity: sinon.spy(),
			},
		)

		const result = await executor.executeToolCalls(
			[
				{
					toolUseId: "call-1",
					call_id: "provider-call-1",
					name: "read_file",
					input: { path: "image.png" },
					isNativeToolCall: true,
				},
			],
			new TaskState(),
			{ coordinator, promptVisibleSpecs: [] } as any,
			createEmptySubagentRunStats(),
			() => {},
		)

		assert.deepEqual(result.toolResultBlocks, [
			{
				type: "tool_result",
				tool_use_id: "call-1",
				call_id: "provider-call-1",
				content: multimodalResult,
			},
		])
		assert.equal(recordToolResult.callCount, 1)
		const recorded = recordToolResult.firstCall.args[1]
		assert.equal(typeof recorded, "string")
		assert.match(recorded, /Image omitted from trajectory: image\/png/)
		assert.doesNotMatch(recorded, /BASE64_IMAGE/)
	})
})

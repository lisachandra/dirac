import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import type { DiracContent, DiracToolResponseContent } from "@shared/messages"
import { pushSubagentToolResultBlock, serializeToolResult } from "../SubagentRunHelpers"

const multimodalResult: DiracToolResponseContent = [
	{ type: "text", text: "image contents" },
	{ type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64_IMAGE" } },
]

describe("SubagentRunHelpers", () => {
	it("preserves multimodal content in native tool results", () => {
		const blocks: DiracContent[] = []
		pushSubagentToolResultBlock(
			blocks,
			{ toolUseId: "call-1", call_id: "provider-call-1", name: "read_file", input: {}, isNativeToolCall: true },
			"[read_file]",
			multimodalResult,
		)

		assert.deepEqual(blocks, [
			{
				type: "tool_result",
				tool_use_id: "call-1",
				call_id: "provider-call-1",
				content: multimodalResult,
			},
		])
		assert.equal(typeof (blocks[0] as any).content, "object")
	})

	it("keeps non-native result images as image blocks", () => {
		const blocks: DiracContent[] = []
		pushSubagentToolResultBlock(
			blocks,
			{ toolUseId: "call-2", name: "read_file", input: {}, isNativeToolCall: false },
			"[read_file]",
			multimodalResult,
		)

		assert.equal(blocks[0].type, "text")
		assert.equal(blocks[2].type, "image")
		assert.deepEqual(blocks[2], multimodalResult[1])
	})

	it("omits base64 payloads from trajectory text", () => {
		const serialized = serializeToolResult(multimodalResult)
		assert.match(serialized, /image contents/)
		assert.match(serialized, /Image omitted from trajectory: image\/png/)
		assert.doesNotMatch(serialized, /BASE64_IMAGE/)
	})
})

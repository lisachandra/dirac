import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { filterMessagesForClaudeCode } from "./message-filter"

describe("filterMessagesForClaudeCode", () => {
	it("removes internal provenance and steering receipt metadata recursively", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "guidance",
						isUserInput: true,
						steeringMessageIds: ["transcript-1"],
					},
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [{ type: "text", text: "nested", isUserInput: true }],
					},
				],
			} as any,
		])
		const content = result[0].content as any[]

		assert.equal("isUserInput" in content[0], false)
		assert.equal("steeringMessageIds" in content[0], false)
		assert.equal("isUserInput" in content[1].content[0], false)
	})

	it("replaces images nested inside tool results without forwarding base64", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [
							{ type: "text", text: "image contents" },
							{ type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64_IMAGE" } },
						],
					},
				],
			} as any,
		])
		const content = result[0].content as any[]
		const nested = content[0].content as any[]

		assert.deepEqual(nested[0], { type: "text", text: "image contents" })
		assert.deepEqual(nested[1], {
			type: "text",
			text: "[Image (base64): image/png not supported by Claude Code]",
		})
		assert.doesNotMatch(JSON.stringify(result), /BASE64_IMAGE/)
	})

	it("replaces direct images without forwarding base64", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "DIRECT_BASE64" } }],
			} as any,
		])

		assert.deepEqual(result[0].content, [{ type: "text", text: "[Image (base64): image/jpeg not supported by Claude Code]" }])
		assert.doesNotMatch(JSON.stringify(result), /DIRECT_BASE64/)
	})

	it("replaces URL images nested inside tool results without forwarding the URL", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-2",
						content: [{ type: "image", source: { type: "url", url: "https://example.com/private.png" } }],
					},
				],
			} as any,
		])
		const content = result[0].content as any[]

		assert.deepEqual(content[0].content, [{ type: "text", text: "[Image (url): unknown not supported by Claude Code]" }])
		assert.doesNotMatch(JSON.stringify(result), /private\.png/)
	})

	it("replaces images nested inside document content", () => {
		const result = filterMessagesForClaudeCode([
			{
				role: "user",
				content: [
					{
						type: "document",
						source: {
							type: "content",
							content: [
								{ type: "text", text: "document text" },
								{
									type: "image",
									source: { type: "base64", media_type: "image/png", data: "DOCUMENT_BASE64" },
								},
								{
									type: "image",
									source: { type: "url", url: "https://example.com/document.png" },
								},
							],
						},
					},
				],
			} as any,
		])
		const document = (result[0].content as any[])[0]

		assert.deepEqual(document.source.content, [
			{ type: "text", text: "document text" },
			{ type: "text", text: "[Image (base64): image/png not supported by Claude Code]" },
			{ type: "text", text: "[Image (url): unknown not supported by Claude Code]" },
		])
		assert.doesNotMatch(JSON.stringify(result), /DOCUMENT_BASE64|document\.png/)
	})
})

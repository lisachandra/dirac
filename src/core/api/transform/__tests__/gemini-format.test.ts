import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { convertAnthropicMessagesToGemini } from "../gemini-format"

describe("convertAnthropicMessagesToGemini", () => {
	it("preserves string tool results in function responses", () => {
		const result = convertAnthropicMessagesToGemini([
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "file.txt" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "call-1", content: "actual output" }],
			},
		] as any)

		assert.deepEqual(result[1].parts?.[0], {
			functionResponse: {
				id: "call-1",
				name: "read_file",
				response: { result: "actual output" },
			},
		})
	})

	it("preserves empty string tool results in function responses", () => {
		const result = convertAnthropicMessagesToGemini([
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "empty.txt" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "call-1", content: "" }],
			},
		] as any)

		assert.deepEqual(result[1].parts?.[0], {
			functionResponse: {
				id: "call-1",
				name: "read_file",
				response: { result: "" },
			},
		})
	})

	it("keeps image-bearing tool results out of function response JSON", () => {
		const result = convertAnthropicMessagesToGemini(
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "image.png" } }],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-1",
							content: [
								{ type: "text", text: "image contents" },
								{ type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64_IMAGE" } },
							],
						},
					],
				},
			] as any,
			"gemini-3-pro-preview",
		)

		const parts = result[1].parts || []
		assert.deepEqual(parts[0], {
			functionResponse: {
				id: "call-1",
				name: "read_file",
				response: { result: "image contents" },
				parts: [{ inlineData: { mimeType: "image/png", data: "BASE64_IMAGE" } }],
			},
		})
		assert.equal(parts.length, 1)
		assert.doesNotMatch(JSON.stringify(parts[0].functionResponse?.response), /BASE64_IMAGE/)
	})

	it("uses a short function response marker for image-only tool results", () => {
		const result = convertAnthropicMessagesToGemini(
			[
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-2",
							content: [
								{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "IMAGE_DATA" } },
							],
						},
					],
				},
			] as any,
			"gemini-3-pro-preview",
		)

		const parts = result[0].parts || []
		assert.deepEqual(parts[0].functionResponse?.response, { result: "[Image attached]" })
		assert.deepEqual(parts[0].functionResponse?.parts, [{ inlineData: { mimeType: "image/jpeg", data: "IMAGE_DATA" } }])
		assert.equal(parts.length, 1)
		assert.doesNotMatch(JSON.stringify(parts[0].functionResponse?.response), /IMAGE_DATA/)
	})

	it("uses separate native image parts for Gemini 2.5 compatibility", () => {
		const result = convertAnthropicMessagesToGemini(
			[
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-2",
							content: [
								{ type: "text", text: "image contents" },
								{ type: "image", source: { type: "base64", media_type: "image/png", data: "IMAGE_DATA" } },
							],
						},
					],
				},
			] as any,
			"gemini-2.5-flash",
		)

		const parts = result[0].parts || []
		assert.deepEqual(parts[0].functionResponse?.response, { result: "image contents" })
		assert.equal(parts[0].functionResponse?.parts, undefined)
		assert.deepEqual(parts[1], { inlineData: { mimeType: "image/png", data: "IMAGE_DATA" } })
		assert.doesNotMatch(JSON.stringify(parts[0]), /IMAGE_DATA/)
	})

	it("rejects unresolved URL images before creating malformed Gemini parts", () => {
		assert.throws(
			() =>
				convertAnthropicMessagesToGemini([
					{
						role: "user",
						content: [{ type: "image", source: { type: "url", url: "https://example.com/image.png" } }],
					},
				] as any),
			/Gemini URL images must be resolved/,
		)
	})
})

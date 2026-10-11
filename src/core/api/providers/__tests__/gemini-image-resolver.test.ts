import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { mockFetchForTesting } from "@/shared/net"
import { resolveGeminiImageSources } from "../gemini-image-resolver"

const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 as const }]
const resolvePublicHost = async () => PUBLIC_ADDRESS

function imageMessage(url: string): any[] {
	return [{ role: "user", content: [{ type: "image", source: { type: "url", url } }] }]
}

describe("resolveGeminiImageSources", () => {
	it("downloads direct and tool-result URL images as inline base64 without mutating history", async () => {
		const messages = [
			{
				role: "user",
				content: [
					{ type: "image", source: { type: "url", url: "https://example.com/direct.png" } },
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: [
							{ type: "text", text: "image contents" },
							{ type: "image", source: { type: "url", url: "https://example.com/tool.png" } },
						],
					},
				],
			},
		] as any
		const requestedUrls: string[] = []
		const responseBytes = Buffer.from("image-bytes")

		const resolved = await mockFetchForTesting(
			async (input) => {
				requestedUrls.push(String(input))
				return new Response(responseBytes, { headers: { "content-type": "image/png" } })
			},
			() => resolveGeminiImageSources(messages, new AbortController().signal, resolvePublicHost),
		)

		assert.deepEqual(requestedUrls, ["https://example.com/direct.png", "https://example.com/tool.png"])
		const resolvedContent = resolved[0].content as any[]
		const originalContent = messages[0].content as any[]
		assert.deepEqual(resolvedContent[0].source, {
			type: "base64",
			media_type: "image/png",
			data: "aW1hZ2UtYnl0ZXM=",
		})
		assert.deepEqual(resolvedContent[1].content[1].source, {
			type: "base64",
			media_type: "image/png",
			data: "aW1hZ2UtYnl0ZXM=",
		})
		assert.equal(originalContent[0].source.type, "url")
		assert.equal(originalContent[1].content[1].source.type, "url")
	})

	it("rejects non-image responses", async () => {
		await assert.rejects(
			mockFetchForTesting(
				async () => new Response("not an image", { headers: { "content-type": "text/plain" } }),
				() =>
					resolveGeminiImageSources(
						imageMessage("https://example.com/not-image"),
						new AbortController().signal,
						resolvePublicHost,
					),
			),
			/unsupported Content-Type 'text\/plain'/,
		)
	})

	it("rejects localhost, private literal addresses, and private DNS results", async () => {
		await assert.rejects(resolveGeminiImageSources(imageMessage("http://localhost/image.png")), /local address/)
		await assert.rejects(resolveGeminiImageSources(imageMessage("http://127.0.0.1/image.png")), /private or reserved/)
		await assert.rejects(resolveGeminiImageSources(imageMessage("http://[::ffff:7f00:1]/image.png")), /private or reserved/)
		await assert.rejects(
			resolveGeminiImageSources(imageMessage("https://internal.example/image.png"), undefined, async () => [
				{ address: "10.0.0.5", family: 4 },
			]),
			/private or reserved/,
		)
	})

	it("revalidates redirect destinations", async () => {
		await assert.rejects(
			mockFetchForTesting(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "http://127.0.0.1/private.png" },
					}),
				() => resolveGeminiImageSources(imageMessage("https://93.184.216.34/image.png")),
			),
			/private or reserved/,
		)
	})

	it("rejects redirects beyond the configured limit", async () => {
		let requestCount = 0
		await assert.rejects(
			mockFetchForTesting(
				async () => {
					requestCount++
					return new Response(null, { status: 302, headers: { location: "/next.png" } })
				},
				() => resolveGeminiImageSources(imageMessage("https://93.184.216.34/image.png")),
			),
			/exceeded 5 redirects/,
		)
		assert.equal(requestCount, 6)
	})

	it("enforces the cumulative inline-image budget", async () => {
		const imageBytes = Buffer.alloc(10 * 1024 * 1024 + 1)
		const messages = [
			{
				role: "user",
				content: [
					{ type: "image", source: { type: "url", url: "https://example.com/first.png" } },
					{ type: "image", source: { type: "url", url: "https://example.com/second.png" } },
				],
			},
		] as any

		await assert.rejects(
			mockFetchForTesting(
				async () => new Response(imageBytes, { headers: { "content-type": "image/png" } }),
				() => resolveGeminiImageSources(messages, undefined, resolvePublicHost),
			),
			/inline images exceed the 20971520-byte request limit/,
		)
	})

	it("stops reading oversized responses without a Content-Length header", async () => {
		const oneMegabyte = new Uint8Array(1024 * 1024)
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let index = 0; index < 21; index++) controller.enqueue(oneMegabyte)
				controller.close()
			},
		})

		await assert.rejects(
			mockFetchForTesting(
				async () => new Response(body, { headers: { "content-type": "image/png" } }),
				() => resolveGeminiImageSources(imageMessage("https://example.com/large.png"), undefined, resolvePublicHost),
			),
			/exceeds the 20971520-byte inline limit/,
		)
	})
})

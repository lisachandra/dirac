import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { mockFetchForTesting } from "@/shared/net"
import { AIhubmixHandler } from "../aihubmix"

const createAsyncIterable = (values: any[] = []) => ({
	[Symbol.asyncIterator]: async function* () {
		yield* values
	},
})

describe("AIhubmixHandler", () => {
	it("resolves Gemini URL images before formatting provider content", async () => {
		const handler = new AIhubmixHandler({
			apiKey: "test-api-key",
			modelId: "gemini-2.5-flash",
		})
		const generateContentStream = sinon.stub().resolves(createAsyncIterable())
		;(handler as any).geminiClient = { models: { generateContentStream } }

		await mockFetchForTesting(
			async () => new Response("image-bytes", { headers: { "content-type": "image/png" } }),
			async () => {
				for await (const _chunk of handler.createMessage("system", [
					{
						role: "user",
						content: [{ type: "image", source: { type: "url", url: "https://93.184.216.34/image.png" } }],
					},
				])) {
					// Consume the provider stream.
				}
			},
		)

		sinon.assert.calledOnce(generateContentStream)
		const request = generateContentStream.firstCall.args[0]
		assert.deepEqual(request.contents[0].parts[0], {
			inlineData: { mimeType: "image/png", data: "aW1hZ2UtYnl0ZXM=" },
		})
		assert.doesNotMatch(JSON.stringify(request.contents), /93\.184\.216\.34/)
	})
})

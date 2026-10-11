import "should"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { ZAiHandler } from "../zai"

describe("ZAiHandler", () => {
	afterEach(() => sinon.restore())

	it("does not log streamed response content", async () => {
		const sensitiveText = "private response content"
		const stream = {
			[Symbol.asyncIterator]: async function* () {
				yield { choices: [{ delta: { content: sensitiveText } }] }
			},
		}
		const handler = new ZAiHandler({ zaiApiKey: "test-key" })
		sinon.stub(handler as any, "ensureClient").returns({
			chat: { completions: { create: sinon.stub().resolves(stream) } },
		})
		const log = sinon.stub(Logger, "info")
		const chunks: any[] = []

		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([{ type: "text", text: sensitiveText }])
		sinon.assert.notCalled(log)
	})

	it("does not count cached prompt tokens twice", async () => {
		const stream = {
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [],
					usage: {
						prompt_tokens: 1200,
						completion_tokens: 50,
						prompt_tokens_details: { cached_tokens: 800 },
					},
				}
			},
		}
		const handler = new ZAiHandler({ zaiApiKey: "test-key" })
		sinon.stub(handler as any, "ensureClient").returns({
			chat: { completions: { create: sinon.stub().resolves(stream) } },
		})
		const chunks: any[] = []

		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				inputTokens: 400,
				outputTokens: 50,
				cacheReadTokens: 800,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
			},
		])
	})

	it("defines GLM-5.3 models with supported reasoning effort metadata", () => {
		const glm53 = new ZAiHandler({ zaiApiKey: "test-key", apiModelId: "glm-5.3" }).getModel()
		const flash = new ZAiHandler({ zaiApiKey: "test-key", apiModelId: "glm-5.3-flash" }).getModel()

		glm53.info.should.containDeep({
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			supportsImages: false,
			supportsReasoning: true,
			supportsReasoningEffort: true,
			reasoningEffortOptions: ["low", "high", "max"],
			defaultReasoningEffort: "max",
			supportsPromptCache: true,
			temperature: 1,
			inputPrice: 1.4,
			cacheReadsPrice: 0.26,
			outputPrice: 4.4,
		})
		flash.info.should.containDeep({
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			supportsImages: true,
			supportsReasoning: true,
			supportsReasoningEffort: true,
			reasoningEffortOptions: ["low", "high", "max"],
			defaultReasoningEffort: "max",
			supportsPromptCache: true,
			temperature: 1,
			inputPrice: 0.15,
			cacheReadsPrice: 0.03,
			outputPrice: 0.5,
		})
	})

	it("sends a supported requested reasoning effort without model-specific request branches", async () => {
		const stream = {
			[Symbol.asyncIterator]: async function* () {},
		}
		const create = sinon.stub().resolves(stream)
		const handler = new ZAiHandler({ zaiApiKey: "test-key", apiModelId: "glm-5.3", reasoningEffort: "low" })
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } })

		for await (const _ of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			// Consume the stream so the request completes.
		}

		const request = create.firstCall.args[0]
		request.should.containDeep({
			model: "glm-5.3",
			max_tokens: 128_000,
			temperature: 1,
			thinking: { type: "enabled" },
			reasoning_effort: "low",
			stream: true,
			tool_stream: true,
		})
		request.should.not.have.property("top_p")
	})

	it("uses the model default when the configured reasoning effort is unsupported", async () => {
		const stream = {
			[Symbol.asyncIterator]: async function* () {},
		}
		const create = sinon.stub().resolves(stream)
		const handler = new ZAiHandler({
			zaiApiKey: "test-key",
			apiModelId: "glm-5.3-flash",
			reasoningEffort: "medium",
		})
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } })

		for await (const _ of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			// Consume the stream so the request completes.
		}

		const request = create.firstCall.args[0]
		request.reasoning_effort.should.equal("max")
		request.thinking.should.deepEqual({ type: "enabled" })
		request.should.not.have.property("clear_thinking")
	})

	it("does not send obsolete thinking controls for earlier GLM models", async () => {
		const stream = {
			[Symbol.asyncIterator]: async function* () {},
		}
		const create = sinon.stub().resolves(stream)
		const handler = new ZAiHandler({ zaiApiKey: "test-key", apiModelId: "glm-5.2", reasoningEffort: "max" })
		sinon.stub(handler as any, "ensureClient").returns({ chat: { completions: { create } } })

		for await (const _ of handler.createMessage("system", [{ role: "user", content: "hello" }])) {
			// Consume the stream so the request completes.
		}

		const request = create.firstCall.args[0]
		request.should.not.have.property("thinking")
		request.should.not.have.property("reasoning_effort")
		request.should.not.have.property("temperature")
	})
})

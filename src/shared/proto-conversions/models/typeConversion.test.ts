import { expect } from "chai"
import { describe, it } from "mocha"
import type { ModelInfo } from "@shared/api"
import { OpenRouterModelInfo } from "@shared/proto/dirac/models"
import { fromProtobufModelInfo, toProtobufModelInfo } from "./typeConversion"

describe("model info protobuf conversion", () => {
	it("round trips constrained reasoning effort metadata", () => {
		const modelInfo: ModelInfo = {
			supportsPromptCache: true,
			supportsReasoning: true,
			supportsReasoningEffort: true,
			reasoningEffortOptions: ["low", "high", "max"],
			defaultReasoningEffort: "max",
		}

		const encoded = OpenRouterModelInfo.encode(toProtobufModelInfo(modelInfo)).finish()
		const restored = fromProtobufModelInfo(OpenRouterModelInfo.decode(encoded))

		expect(restored.reasoningEffortOptions).to.deep.equal(["low", "high", "max"])
		expect(restored.defaultReasoningEffort).to.equal("max")
	})

	it("filters unsupported reasoning effort metadata from protobuf input", () => {
		const protoInfo = OpenRouterModelInfo.create({
			supportsPromptCache: true,
			supportsReasoningEffort: true,
			reasoningEffortOptions: ["low", "turbo", "max"],
			defaultReasoningEffort: "turbo",
		})

		const restored = fromProtobufModelInfo(protoInfo)

		expect(restored.reasoningEffortOptions).to.deep.equal(["low", "max"])
		expect(restored.defaultReasoningEffort).to.equal(undefined)
	})
})

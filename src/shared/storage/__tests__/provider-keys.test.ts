import { bedrockDefaultModelId, moonshotDefaultModelId, openAiNativeDefaultModelId } from "@shared/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { getProviderDefaultModelId, getProviderModelIdKey } from "../provider-keys"

describe("Provider key mapping", () => {
	it("returns Moonshot default model ID", () => {
		expect(getProviderDefaultModelId("moonshot")).to.equal(moonshotDefaultModelId)
	})

	it("uses the OpenAI Native default for the OpenAI-compatible provider", () => {
		expect(getProviderDefaultModelId("openai")).to.equal(openAiNativeDefaultModelId)
	})

	it("uses generic model key for Moonshot", () => {
		expect(getProviderModelIdKey("moonshot", "act")).to.equal("actModeApiModelId")
		expect(getProviderModelIdKey("moonshot", "plan")).to.equal("planModeApiModelId")
	})

	it("keeps provider-specific model key behavior for OpenRouter", () => {
		expect(getProviderModelIdKey("openrouter", "act")).to.equal("actModeOpenRouterModelId")
		expect(getProviderModelIdKey("openrouter", "plan")).to.equal("planModeOpenRouterModelId")
	})


	it("uses generic model key for Bedrock", () => {
		expect(getProviderModelIdKey("bedrock", "act")).to.equal("actModeApiModelId")
		expect(getProviderModelIdKey("bedrock", "plan")).to.equal("planModeApiModelId")
	})

	it("returns Bedrock default model ID", () => {
		expect(getProviderDefaultModelId("bedrock")).to.equal(bedrockDefaultModelId)
	})
})

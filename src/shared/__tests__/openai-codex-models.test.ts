import { describe, it } from "mocha"
import "should"
import {
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openAiNativeDefaultModelId,
	openAiNativeModels,
} from "../api"

describe("openAiCodexModels", () => {
	it("includes supported GPT-5 and GPT-6 variants available through ChatGPT Codex auth", () => {
		Object.keys(openAiCodexModels).should.deepEqual([
			"gpt-5.5",
			"gpt-5.4",
			"gpt-5.4-mini",
			"gpt-5.4-nano",
			"gpt-5.4-pro",
			"gpt-5.6-sol",
			"gpt-6-astra",
			"gpt-5.6-terra",
			"gpt-5.6-luna",
		])
	})

	it("uses GPT-6 Astra as the OpenAI Native and Codex default", () => {
		openAiNativeDefaultModelId.should.equal("gpt-6-astra")
		openAiCodexDefaultModelId.should.equal("gpt-6-astra")
	})

	it("defines GPT-5.5 metadata", () => {
		openAiCodexModels["gpt-5.5"].contextWindow!.should.equal(1_050_000)
		openAiCodexModels["gpt-5.5"].maxTokens!.should.equal(128_000)
		openAiCodexModels["gpt-5.5"].supportsReasoning!.should.equal(true)
		openAiCodexModels["gpt-5.5"].description!.should.containEql("Dec 01, 2025")
	})

	it("configures GPT-6 Astra like GPT-5.6 Sol", () => {
		const nativeAstra = openAiNativeModels["gpt-6-astra"]
		const nativeSol = openAiNativeModels["gpt-5.6-sol"]
		nativeAstra.maxTokens!.should.equal(nativeSol.maxTokens!)
		nativeAstra.contextWindow!.should.equal(nativeSol.contextWindow!)
		nativeAstra.inputPrice.should.equal(nativeSol.inputPrice)
		nativeAstra.outputPrice.should.equal(nativeSol.outputPrice)
		nativeAstra.fastModePriceMultiplier.should.equal(nativeSol.fastModePriceMultiplier)
		nativeAstra.supportsPersistedReasoning.should.equal(true)

		const codexAstra = openAiCodexModels["gpt-6-astra"]
		codexAstra.maxTokens!.should.equal(openAiCodexModels["gpt-5.6-sol"].maxTokens!)
		codexAstra.supportsPersistedReasoning.should.equal(true)
	})
})

import { describe, it } from "mocha"
import "should"
import { isGptGenerationAtLeast, supportsOpenAiPersistedReasoning } from "./model-utils"

describe("OpenAI model compatibility", () => {
	it("compares GPT generations numerically across supported ID forms", () => {
		isGptGenerationAtLeast("gpt-5", 5).should.equal(true)
		isGptGenerationAtLeast("gpt5.6-sol", 5).should.equal(true)
		isGptGenerationAtLeast("gpt-6-astra", 6).should.equal(true)
		isGptGenerationAtLeast("openai/gpt-6-astra", 6).should.equal(true)
		isGptGenerationAtLeast("openai/gpt-10", 6).should.equal(true)
	})

	it("rejects older, non-GPT, and malformed model IDs", () => {
		isGptGenerationAtLeast("gpt-5.6-sol", 6).should.equal(false)
		isGptGenerationAtLeast("gpt-4o", 5).should.equal(false)
		isGptGenerationAtLeast("gpt-oss-120b", 5).should.equal(false)
		isGptGenerationAtLeast("notgpt-6", 6).should.equal(false)
	})

	it("enables persisted reasoning explicitly for GPT-5 and implicitly after GPT-5", () => {
		supportsOpenAiPersistedReasoning("gpt-5.6-sol", true).should.equal(true)
		supportsOpenAiPersistedReasoning("gpt-5.5").should.equal(false)
		supportsOpenAiPersistedReasoning("gpt-6-astra").should.equal(true)
		supportsOpenAiPersistedReasoning("openai/gpt-10").should.equal(true)
	})
})

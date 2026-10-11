import { describe, it } from "mocha"
import "should"
import { getHookModelContext } from "../hook-model-context"

describe("getHookModelContext", () => {
	it("uses the explicit request-bound provider and active handler model", () => {
		const api = {
			getModel: () => ({ id: "anthropic/claude-sonnet-4.5" }),
		} as any

		const context = getHookModelContext(api, { providerId: "openrouter" })
		context.provider.should.equal("openrouter")
		context.slug.should.equal("anthropic/claude-sonnet-4.5")
	})

	it("does not need mutable process configuration to report an Act model", () => {
		const api = {
			getModel: () => ({ id: "gpt-5" }),
		} as any

		const context = getHookModelContext(api, { providerId: "openai" })
		context.provider.should.equal("openai")
		context.slug.should.equal("gpt-5")
	})

	it("falls back to unknown values when provider and handler model are unavailable", () => {
		const api = {
			getModel: () => ({ id: "" }),
		} as any

		const context = getHookModelContext(api, {})
		context.provider.should.equal("unknown")
		context.slug.should.equal("unknown")
	})
})

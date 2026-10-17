import { beforeEach, describe, expect, it, vi } from "vitest"
import { DiracAgent } from "./DiracAgent.js"

const mocks = vi.hoisted(() => ({
	flushPendingState: vi.fn(async () => undefined),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: vi.fn(() => ({ flushPendingState: mocks.flushPendingState })),
	},
}))

interface ModelRoute {
	sessionId: string
	provider: string
	modelId: string
}

/**
 * ACP clients call `session/set_model` with either "provider/model" or a bare id
 * (a gateway model name such as "gpt-6-astra"). Both must route to a model change
 * for the session's current provider.
 */
function routedModel() {
	const agent = new DiracAgent({})
	const routes: ModelRoute[] = []
	const session = { sessionId: "session-1", cwd: "/workspace", mode: "act", createdAt: 1, lastActivityAt: 1 }

	;(agent as any).sessions.set(session.sessionId, session)
	;(agent as any).acpSessionOverrides.set(session.sessionId, {
		mode: "act",
		planActSeparateModelsSetting: false,
		planModeApiProvider: "openai",
		actModeApiProvider: "openai",
		actModeOpenAiModelId: "th/deepseek-v4.1-flash",
	})
	;(agent as any).emitConfigOptionsUpdate = vi.fn(async () => undefined)
	;(agent as any).sessionConfig = {
		computeCurrentAcpModeId: () => "act",
		applyProviderAndModel: async (target: { sessionId: string }, provider: string, modelId: string) => {
			routes.push({ sessionId: target.sessionId, provider, modelId })
		},
	}
	return { agent, routes }
}

describe("DiracAgent session model routing", () => {
	beforeEach(() => {
		mocks.flushPendingState.mockClear()
	})

	it("applies a bare gateway model id to the session's current provider", async () => {
		const { agent, routes } = routedModel()

		await agent.unstable_setSessionModel({ sessionId: "session-1", modelId: "gpt-6-astra" })

		expect(routes).toEqual([{ sessionId: "session-1", provider: "openai", modelId: "gpt-6-astra" }])
	})

	it("treats an unrecognized prefix as part of the literal gateway model id", async () => {
		const { agent, routes } = routedModel()

		await agent.unstable_setSessionModel({ sessionId: "session-1", modelId: "cp/mimo-v2.6-flash" })

		expect(routes).toEqual([{ sessionId: "session-1", provider: "openai", modelId: "cp/mimo-v2.6-flash" }])
	})

	it("switches providers when the prefix names a real Dirac provider", async () => {
		const { agent, routes } = routedModel()

		await agent.unstable_setSessionModel({ sessionId: "session-1", modelId: "anthropic/claude-sonnet-5" })

		expect(routes).toEqual([{ sessionId: "session-1", provider: "anthropic", modelId: "claude-sonnet-5" }])
	})
})

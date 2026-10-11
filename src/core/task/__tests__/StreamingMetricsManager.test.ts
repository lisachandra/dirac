import { expect } from "chai"
import { describe, it } from "mocha"
import { StreamingMetricsManager } from "../StreamingMetricsManager"
import { DiracMessageType } from "@shared/ExtensionMessage"

function stubApi(contextWindow?: number) {
	return {
		getModel: () => ({ info: { contextWindow } }),
	} as any
}

describe("StreamingMetricsManager", () => {
	it("merges usage chunks into running totals", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, reasoningTokens: 2 })
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 3, cacheReadTokens: 4 })

		expect(manager.getMetrics()).to.deep.equal({
			inputTokens: 10,
			outputTokens: 5,
			reasoningTokens: 2,
			cacheWriteTokens: 3,
			cacheReadTokens: 4,
			totalCost: undefined,
			availability: {
				inputTokens: true,
				outputTokens: true,
				reasoningTokens: true,
				cacheWrites: true,
				cacheReads: true,
				cost: false,
			},
		})
	})

	it("falls back to thoughtsTokenCount for reasoning and keeps prior cache values", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1, thoughtsTokenCount: 7 })
		// a later chunk without cache values must keep the previous ones
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1, cacheWriteTokens: 9 })
		manager.updateFromChunk({ inputTokens: 1, outputTokens: 1 })

		expect(manager.getMetrics().reasoningTokens).to.equal(7)
		expect(manager.getMetrics().cacheWriteTokens).to.equal(9)
	})

	it("returns the provider-calculated total cost when present", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, totalCost: 1.23 })
		expect(manager.getTotalCost()).to.equal(1.23)
	})

	it("preserves provider-reported zero cost", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5, totalCost: 0 })
		expect(manager.getTotalCost()).to.equal(0)
	})

	it("returns undefined when provider totalCost is absent and model has no pricing", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi(100_000) as any)
		manager.updateFromChunk({ inputTokens: 0, outputTokens: 0 })
		// no provider cost + no model pricing -> unknown, not zero
		expect(manager.getTotalCost()).to.be.undefined
	})

	it("returns 0 when provider totalCost is absent but model has explicit zero pricing", () => {
		const freeApi = { getModel: () => ({ info: { contextWindow: 100_000, inputPrice: 0, outputPrice: 0 } }) } as any
		const manager = new StreamingMetricsManager({} as any, 0, freeApi)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5 })
		// explicitly free model -> cost is genuinely 0
		expect(manager.getTotalCost()).to.equal(0)
	})

	it("does not estimate cost when the provider requires reported cost", () => {
		const api = {
			getModel: () => ({ info: { contextWindow: 100_000, inputPrice: 1, outputPrice: 2 } }),
			shouldEstimateCost: () => false,
		} as any
		const manager = new StreamingMetricsManager({} as any, 0, api)
		manager.updateFromChunk({ inputTokens: 10, outputTokens: 5 })
		expect(manager.getTotalCost()).to.be.undefined
	})

	it("writes context window and provider-reported cost to the API-status message", async () => {
		const message = {
			id: "api-status-1",
			ts: 1,
			content: { type: DiracMessageType.API_STATUS, status: {} },
		}
		const messageStateHandler = {
			getDiracMessages: () => [message],
			patchApiStatusById: async (_id: string, patch: object, deletions: string[]) => {
				Object.assign(message.content.status, patch)
				for (const key of deletions) delete (message.content.status as Record<string, unknown>)[key]
			},
		} as any
		const api = {
			getModel: () => ({ info: { contextWindow: 1_048_576 } }),
			shouldEstimateCost: () => false,
		} as any
		const manager = new StreamingMetricsManager(messageStateHandler, 0, api)
		manager.updateFromChunk({ inputTokens: 12_000, outputTokens: 345, totalCost: 0.0123 })

		await manager.updateApiReqMsgFromMetrics()

		expect(message.content.status).to.include({
			tokensIn: 12_000,
			tokensOut: 345,
			cost: 0.0123,
			contextWindow: 1_048_576,
		})
	})

	it("getMetrics returns a snapshot, not a live reference", () => {
		const manager = new StreamingMetricsManager({} as any, 0, stubApi() as any)
		const snapshot = manager.getMetrics()
		snapshot.inputTokens = 999
		expect(manager.getMetrics().inputTokens).to.equal(0)
	})
})

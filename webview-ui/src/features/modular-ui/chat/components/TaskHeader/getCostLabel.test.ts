import type { ModelInfo } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getCostLabel } from "./getCostLabel"

const paid: ModelInfo = { supportsPromptCache: true, inputPrice: 3.0, outputPrice: 15.0 }
const free: ModelInfo = { supportsPromptCache: true, inputPrice: 0, outputPrice: 0 }
const unknown: ModelInfo = { supportsPromptCache: true }

describe("getCostLabel", () => {
	it("returns n/a when model info is missing and no cost has accrued", () => {
		expect(getCostLabel(0)).toBe("n/a")
	})

	it("returns n/a when pricing is unknown and no cost has accrued", () => {
		expect(getCostLabel(0, unknown)).toBe("n/a")
	})

	it("returns Free for explicitly zero-priced models with no accrued cost", () => {
		expect(getCostLabel(0, free)).toBe("Free")
	})

	it("returns an accrued cost regardless of current model pricing", () => {
		expect(getCostLabel(1.23)).toBe("$1.2300")
		expect(getCostLabel(1.23, unknown)).toBe("$1.2300")
		expect(getCostLabel(1.23, free)).toBe("$1.2300")
	})

	// Regression: paid model with totalCost === 0 must show $0.0000, not Free.
	it("returns $0.0000 for paid models with no usage yet", () => {
		expect(getCostLabel(0, paid)).toBe("$0.0000")
	})

	it("returns formatted cost for paid models with usage", () => {
		expect(getCostLabel(0.0105, paid)).toBe("$0.0105")
	})
})

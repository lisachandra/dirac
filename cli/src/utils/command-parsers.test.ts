import { InvalidArgumentError } from "commander"
import { describe, expect, it } from "vitest"
import {
	parseInferenceSpeed,
	parseNonNegativeInteger,
	parsePositiveInteger,
	parseReasoningEffort,
	parseThinkingBudget,
	parseToolIdentifiers,
} from "./command-parsers"

describe("parseToolIdentifiers", () => {
	it("parses CSV values, trims whitespace, deduplicates, and accumulates repeated options", () => {
		expect(parseToolIdentifiers("read_file, edit_file,read_file", ["search_files"])).toEqual([
			"search_files",
			"read_file",
			"edit_file",
		])
	})

	it.each(["", " ", ",", "read_file,", ",read_file", "read_file,,edit_file"])("rejects %j", (value) => {
		expect(() => parseToolIdentifiers(value)).toThrow(InvalidArgumentError)
	})
})

describe("parsePositiveInteger", () => {
	it.each(["1", "20", "9007199254740991"])("accepts %s", (value) => {
		expect(parsePositiveInteger(value)).toBe(Number(value))
	})

	it.each(["0", "-1", "1.5", "2items", "", "Infinity", "NaN", "9007199254740992"])("rejects %s", (value) => {
		expect(() => parsePositiveInteger(value)).toThrow(InvalidArgumentError)
	})
})

describe("parseThinkingBudget", () => {
	it.each(["0", "1", "4096"])("accepts %s", (value) => {
		expect(parseThinkingBudget(value)).toBe(Number(value))
	})

	it.each(["-1", "1.5", "4096tokens", "", "Infinity", "NaN", "9007199254740992"])("rejects %s", (value) => {
		expect(() => parseThinkingBudget(value)).toThrow(InvalidArgumentError)
	})
})

describe("parseNonNegativeInteger", () => {
	it.each(["0", "1", "20", "9007199254740991"])("accepts %s", (value) => {
		expect(parseNonNegativeInteger(value)).toBe(Number(value))
	})

	it.each(["-1", "1.5", "2items", "", "Infinity", "NaN", "9007199254740992"])("rejects %s", (value) => {
		expect(() => parseNonNegativeInteger(value)).toThrow(InvalidArgumentError)
	})
})

describe("parseReasoningEffort", () => {
	it("accepts exported reasoning efforts case-insensitively", () => {
		expect(parseReasoningEffort("MINIMAL")).toBe("minimal")
		expect(parseReasoningEffort("XHIGH")).toBe("xhigh")
		expect(parseReasoningEffort("MAX")).toBe("max")
	})

	it("rejects unknown reasoning efforts", () => {
		expect(() => parseReasoningEffort("extreme")).toThrow("Reasoning effort must be one of")
	})
})


describe("parseInferenceSpeed", () => {
	it("accepts supported speeds case-insensitively", () => {
		expect(parseInferenceSpeed("DEFAULT")).toBe("default")
		expect(parseInferenceSpeed("STANDARD")).toBe("standard")
		expect(parseInferenceSpeed("FAST")).toBe("fast")
	})

	it("rejects unknown speeds", () => {
		expect(() => parseInferenceSpeed("turbo")).toThrow("Inference speed must be one of")
	})
})

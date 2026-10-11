import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CliEnvServiceClient } from "./index"

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock("open", () => ({ default: mocks.open }))
vi.mock("@/core/storage/StateManager", () => ({ StateManager: {} }))
vi.mock("../utils/display", () => ({ printError: vi.fn(), printInfo: vi.fn(), printWarning: vi.fn() }))

describe("CLI host browser opening", () => {
	beforeEach(() => vi.resetAllMocks())
	afterEach(() => vi.useRealTimers())

	it("propagates invocation failures instead of reporting success", async () => {
		mocks.open.mockRejectedValue(new Error("No browser available"))
		await expect(new CliEnvServiceClient().openExternal({ value: "https://example.com" })).rejects.toThrow(
			"No browser available",
		)
	})

	it.each(["spawn error", "nonzero exit", "signal"])("propagates %s from the real launcher utility", async (outcome) => {
		const child = new EventEmitter()
		mocks.open.mockResolvedValue(child)
		const result = new CliEnvServiceClient().openExternal({ value: "https://example.com" })
		const assertion = expect(result).rejects.toThrow(outcome === "spawn error" ? "ENOENT" : "Browser launcher failed")
		await vi.waitFor(() => expect(child.listenerCount("close")).toBe(1))
		if (outcome === "spawn error") child.emit("error", new Error("ENOENT"))
		else child.emit("close", outcome === "signal" ? null : 3, outcome === "signal" ? "SIGTERM" : null)
		await assertion
	})

	it("returns success when the launcher remains running past startup", async () => {
		vi.useFakeTimers()
		const child = Object.assign(new EventEmitter(), { pid: 123 })
		mocks.open.mockResolvedValue(child)
		const result = new CliEnvServiceClient().openExternal({ value: "https://example.com" })
		await vi.waitFor(() => expect(child.listenerCount("close")).toBe(1))
		await vi.advanceTimersByTimeAsync(1000)
		await expect(result).resolves.toEqual({})
		expect(child.listenerCount("close")).toBe(0)
	})
})

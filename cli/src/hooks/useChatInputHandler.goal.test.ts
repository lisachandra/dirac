import { describe, expect, it } from "vitest"
import { getGoalKeyboardShortcut } from "./useChatInputHandler"

describe("getGoalKeyboardShortcut", () => {
	it("uses collision-safe Ctrl+G for Goal details", () => {
		expect(getGoalKeyboardShortcut("g", { ctrl: true }, "working")).toBe("details")
		expect(getGoalKeyboardShortcut("\u0007", { ctrl: true }, "blocked")).toBe("details")
		expect(getGoalKeyboardShortcut("g", {}, "working")).toBeUndefined()
		expect(getGoalKeyboardShortcut("g", { ctrl: true })).toBeUndefined()
	})

	it("offers Pause only while working or waiting", () => {
		expect(getGoalKeyboardShortcut("p", { ctrl: true }, "working")).toBe("pause")
		expect(getGoalKeyboardShortcut("\u0010", { ctrl: true }, "waiting")).toBe("pause")
		expect(getGoalKeyboardShortcut("p", { ctrl: true }, "paused")).toBeUndefined()
	})

	it("offers Resume only while paused or blocked, never when stopped", () => {
		expect(getGoalKeyboardShortcut("r", { ctrl: true }, "paused")).toBe("resume")
		expect(getGoalKeyboardShortcut("\u0012", { ctrl: true }, "blocked")).toBe("resume")
		expect(getGoalKeyboardShortcut("r", { ctrl: true }, "stopped")).toBeUndefined()
	})

	it("offers permanent Stop for every nonterminal Goal status", () => {
		for (const status of ["working", "waiting", "paused", "blocked"] as const) {
			expect(getGoalKeyboardShortcut("x", { ctrl: true }, status)).toBe("stop")
		}
		expect(getGoalKeyboardShortcut("x", { ctrl: true }, "achieved")).toBeUndefined()
		expect(getGoalKeyboardShortcut("x", { ctrl: true }, "stopped")).toBeUndefined()
	})
})

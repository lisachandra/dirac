import { describe, expect, it } from "vitest"
import { browserToolEnabledUpdate, isBrowserToolEnabled } from "./BrowserSettingsSection"

describe("browser tool enablement adapter", () => {
	it("presents the inverse disableToolUse field as positive enablement", () => {
		expect(isBrowserToolEnabled({ disableToolUse: true })).toBe(false)
		expect(isBrowserToolEnabled({ disableToolUse: false })).toBe(true)
		expect(isBrowserToolEnabled({})).toBe(true)
	})

	it("writes the existing inverse field without renaming it", () => {
		expect(browserToolEnabledUpdate(true)).toEqual({ disableToolUse: false })
		expect(browserToolEnabledUpdate(false)).toEqual({ disableToolUse: true })
	})
})

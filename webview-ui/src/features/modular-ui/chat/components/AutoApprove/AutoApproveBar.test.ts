import { describe, expect, it } from "vitest"
import { getAutonomySummary } from "./AutoApproveBar"

describe("getAutonomySummary", () => {
	it.each([
		[true, true, { readFiles: true }, true, "YOLO Mode"],
		[false, true, { readFiles: true }, true, "Approve All"],
		[false, false, { readFiles: true }, true, "Selected auto-approval"],
		[false, false, { readFiles: false }, true, "AI-assisted approval"],
		[false, false, { readFiles: false, editFiles: undefined }, false, "Ask every time"],
	] as const)(
		"applies autonomy precedence for YOLO=%s and Approve All=%s",
		(yoloModeToggled, autoApproveAllToggled, actions, utilityApprovalEnabled, expected) => {
			expect(getAutonomySummary(yoloModeToggled, autoApproveAllToggled, actions, utilityApprovalEnabled)).toBe(expected)
		},
	)
})

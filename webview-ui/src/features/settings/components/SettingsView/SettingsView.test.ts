import { SETTINGS_DESTINATION_IDS, SETTINGS_DESTINATIONS } from "@shared/settings-presentation"
import { describe, expect, it } from "vitest"
import { resolveSettingsTarget } from "./SettingsView"

describe("resolveSettingsTarget", () => {
	it("opens Models & API by default", () => {
		expect(resolveSettingsTarget()).toEqual({ tab: "models-api" })
	})

	it("preserves canonical destination IDs", () => {
		for (const id of SETTINGS_DESTINATION_IDS) expect(resolveSettingsTarget(id)).toEqual({ tab: id })
	})

	it("provides unique single-word labels for compact navigation", () => {
		const compactLabels = SETTINGS_DESTINATION_IDS.map((id) => SETTINGS_DESTINATIONS[id].compactLabel)

		expect(new Set(compactLabels).size).toBe(SETTINGS_DESTINATION_IDS.length)
		for (const label of compactLabels) expect(label).toMatch(/^\S+$/)
	})

	it.each([
		["api-config", { tab: "models-api" }],
		["user-approved-commands", { tab: "approvals", focusId: "user-approved-commands" }],
		["auto-approve", { tab: "approvals", focusId: "auto-approve-actions" }],
		["approved-command-rules", { tab: "approvals", focusId: "user-approved-commands" }],
		["strict-plan-mode", { tab: "approvals", focusId: "approval-policies" }],
		["yolo", { tab: "approvals", focusId: "yolo-mode" }],
		["auto-compact", { tab: "responses-context", focusId: "auto-condense-conversations" }],
		["low-verbosity-responses", { tab: "responses-context", focusId: "low-verbosity-responses" }],
		["dirac-web-tools", { tab: "tools", focusId: "web-search-fetch" }],
		["hooks", { tab: "tools", focusId: "hooks" }],
		["about", { tab: "general", focusId: "about" }],
		["debug", { tab: "general", focusId: "advanced-diagnostics" }],
	])("maps legacy target %s to its editable owner", (target, expected) => {
		expect(resolveSettingsTarget(target)).toEqual(expected)
	})

	it("falls back to Running Tasks while preserving an unknown feature focus ID", () => {
		expect(resolveSettingsTarget("future-feature")).toEqual({
			tab: "running-tasks",
			focusId: "future-feature",
		})
	})
})

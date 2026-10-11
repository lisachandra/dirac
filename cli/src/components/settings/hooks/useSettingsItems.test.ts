import type { ToolMetadata } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { SettingsItemType, SettingsTab } from "../types"
import { createSettingsSearchResults, createToolItems, type UseSettingsItemsProps } from "./useSettingsItems"

const tool = (id: string, source: ToolMetadata["source"]): ToolMetadata => ({
	id,
	name: `${source} tool`,
	description: `${source} tool description`,
	source,
	modulePath: `/${source}/${id}.ts`,
})

const props = {
	currentTab: SettingsTab.TOOLS,
	features: { webTools: true },
	availableTools: [tool("builtin-tool", "builtin"), tool("global-tool", "global"), tool("task-tool", "task")],
	toolToggles: { "global-tool": true, "task-tool": false },
} as unknown as UseSettingsItemsProps

describe("CLI tool settings presentation", () => {
	it("shows effective defaults and keeps task tools read-only and enabled", () => {
		const items = createToolItems(props)
		const builtin = items.find((item) => item.key === "builtin-tool")
		const global = items.find((item) => item.key === "global-tool")
		const task = items.find((item) => item.key === "task-tool")

		expect(builtin).toMatchObject({ type: SettingsItemType.CHECKBOX, value: true })
		expect(global).toMatchObject({ type: SettingsItemType.CHECKBOX, value: true })
		expect(task).toMatchObject({ type: SettingsItemType.READONLY, value: "Enabled" })
		expect(task?.description).toContain("Task-scoped tools are always enabled")
	})

	it("indexes tool descriptions, source help, and persistence scope for search", () => {
		const results = createSettingsSearchResults(props, [SettingsTab.TOOLS])
		const global = results.find((result) => result.item.key === "global-tool")

		expect(global?.searchText).toContain("global tool description")
		expect(global?.searchText).toContain("global configuration")
		expect(global?.searchText).toContain("saved to global settings")
	})

	it("indexes legacy setting aliases for search", () => {
		const results = createSettingsSearchResults(props, [SettingsTab.RESPONSES_CONTEXT])
		const autoCondense = results.find((result) => result.item.key === "autoCondense")

		expect(autoCondense?.searchText).toContain("auto compact")
		expect(autoCondense?.searchText).toContain("auto-compact")
	})
})

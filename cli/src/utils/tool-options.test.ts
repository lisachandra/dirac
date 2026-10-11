import type { DiscoveredTool } from "@/core/task/tools/discovery/DiscoveredTool"
import { applyToolSelectionPolicy } from "@/core/task/tools/runtime/ToolSelectionPolicy"
import type { DiracDefaultTool, DiracToolSpec } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { resolveToolSelectionPolicy } from "./tool-options"

function tool(
	id: string,
	overrides: Partial<Pick<DiscoveredTool, "name" | "source" | "exposure">> = {},
): DiscoveredTool {
	const name = overrides.name ?? id
	return {
		id,
		name,
		source: overrides.source ?? "builtin",
		exposure: overrides.exposure ?? { kind: "configurable" },
		spec: { id: id as DiracDefaultTool, name, description: id } as DiracToolSpec,
		factory: () => ({}) as never,
		modulePath: `/${id}/tool.ts`,
	}
}

const tools = [tool("read_file"), tool("edit_file"), tool("custom_id", { name: "custom_name", source: "global" })]

describe("resolveToolSelectionPolicy", () => {
	it("resolves names to canonical IDs for delta selection", () => {
		expect(resolveToolSelectionPolicy({ enableTool: ["custom_name"], disableTool: ["edit_file"] }, tools)).toEqual({
			mode: "delta",
			enabledToolIds: ["custom_id"],
			disabledToolIds: ["edit_file"],
		})
	})

	it("resolves only-tools as an exact canonical set", () => {
		expect(resolveToolSelectionPolicy({ onlyTools: ["read_file"] }, tools)).toEqual({
			mode: "exact",
			toolIds: ["read_file"],
		})
	})

	it("rejects exact and delta modes together", () => {
		expect(() =>
			resolveToolSelectionPolicy({ onlyTools: ["read_file"], enableTool: ["edit_file"] }, tools),
		).toThrow("--only-tools cannot be combined")
	})

	it("rejects canonical conflicts across aliases", () => {
		expect(() =>
			resolveToolSelectionPolicy({ enableTool: ["custom_name"], disableTool: ["custom_id"] }, tools),
		).toThrow("both enabled and disabled: custom_id")
	})

	it("rejects unknown and non-configurable tools", () => {
		expect(() => resolveToolSelectionPolicy({ enableTool: ["missing"] }, tools)).toThrow("Unknown tool 'missing'")
		const skillOnly = tool("internal", {
			exposure: { kind: "skill_only", authorizedSkillIds: ["skill"] },
		})
		expect(() => resolveToolSelectionPolicy({ enableTool: ["internal"] }, [...tools, skillOnly])).toThrow(
			"cannot be selected",
		)
	})

	it("rejects task-scoped tools", () => {
		const taskTool = tool("task_tool", { source: "task" })
		expect(() => resolveToolSelectionPolicy({ onlyTools: ["task_tool"] }, [...tools, taskTool])).toThrow(
			"cannot be selected",
		)
	})
})

describe("applyToolSelectionPolicy", () => {
	it("applies exact selection without removing task-scoped tools", () => {
		const readFile = tool("read_file")
		const editFile = tool("edit_file")
		const taskTool = tool("task_tool", { source: "task" })
		const selected = applyToolSelectionPolicy(
			[readFile, editFile, taskTool],
			[readFile, taskTool],
			{ mode: "exact", toolIds: ["edit_file"] },
		)
		expect(selected.map((candidate) => candidate.id)).toEqual(["edit_file", "task_tool"])
	})

	it("does not apply a shared-tool delta to a task-scoped overlay with the same ID", () => {
		const taskOverlay = tool("custom_id", { source: "task" })
		const selected = applyToolSelectionPolicy(
			[taskOverlay],
			[taskOverlay],
			{ mode: "delta", enabledToolIds: [], disabledToolIds: ["custom_id"] },
		)
		expect(selected).toEqual([taskOverlay])
	})
})

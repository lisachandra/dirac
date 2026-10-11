import type { DiscoveredTool } from "@/core/task/tools/discovery/DiscoveredTool"
import { refreshToolRegistryForWorkspace } from "@/core/task/tools/registry/refreshToolRegistry"
import type { ToolSelectionPolicy } from "@/core/task/tools/runtime/ToolSelectionPolicy"
import { StateManager } from "@/core/storage/StateManager"
import type { TaskOptions } from "../types"

type ToolSelectionOptions = Pick<TaskOptions, "enableTool" | "disableTool" | "onlyTools">

export function hasToolSelectionOptions(options: ToolSelectionOptions): boolean {
	return Boolean(options.onlyTools?.length || options.enableTool?.length || options.disableTool?.length)
}

function toolIdentifiers(tool: DiscoveredTool): string[] {
	return [tool.id, tool.name, tool.spec.name]
}

function resolveCanonicalToolIds(requested: readonly string[], tools: readonly DiscoveredTool[]): Set<string> {
	const configurableTools = tools.filter((tool) => tool.exposure.kind === "configurable" && tool.source !== "task")
	const validIds = configurableTools.map((tool) => tool.id).sort()
	const resolved = new Set<string>()

	for (const requestedId of requested) {
		const matches = tools.filter((tool) => toolIdentifiers(tool).includes(requestedId))
		if (matches.length === 0) {
			throw new Error(`Unknown tool '${requestedId}'. Valid configurable tool IDs: ${validIds.join(", ")}`)
		}
		if (matches.length > 1) {
			throw new Error(`Tool identifier '${requestedId}' is ambiguous. Use a canonical tool ID.`)
		}
		const [tool] = matches
		if (tool.exposure.kind !== "configurable" || tool.source === "task") {
			throw new Error(`Tool '${requestedId}' cannot be selected with CLI tool options.`)
		}
		resolved.add(tool.id)
	}

	return resolved
}

export function resolveToolSelectionPolicy(
	options: ToolSelectionOptions,
	tools: readonly DiscoveredTool[],
): ToolSelectionPolicy {
	const hasOnlyTools = Boolean(options.onlyTools?.length)
	const hasDeltaTools = Boolean(options.enableTool?.length || options.disableTool?.length)
	if (hasOnlyTools && hasDeltaTools) {
		throw new Error("--only-tools cannot be combined with --enable-tool or --disable-tool.")
	}

	if (hasOnlyTools) {
		return { mode: "exact", toolIds: [...resolveCanonicalToolIds(options.onlyTools!, tools)] }
	}

	const enabledIds = resolveCanonicalToolIds(options.enableTool ?? [], tools)
	const disabledIds = resolveCanonicalToolIds(options.disableTool ?? [], tools)
	const conflictingIds = [...enabledIds].filter((toolId) => disabledIds.has(toolId)).sort()
	if (conflictingIds.length > 0) {
		throw new Error(`Tools cannot be both enabled and disabled: ${conflictingIds.join(", ")}`)
	}
	return { mode: "delta", enabledToolIds: [...enabledIds], disabledToolIds: [...disabledIds] }
}


/** Validate invocation-scoped tool options and return their canonical task policy. */
export async function applyToolSelectionOptions(
	options: ToolSelectionOptions,
	workspaceRoot: string,
): Promise<ToolSelectionPolicy | undefined> {
	if (!hasToolSelectionOptions(options)) return undefined

	const configuredToggles = StateManager.get().getGlobalSettingsKey("toolToggles") ?? {}
	return refreshToolRegistryForWorkspace(
		{ workspaceRoot, includeUserTools: true, toggles: configuredToggles },
		(registry) => resolveToolSelectionPolicy(options, registry.getAllTools(undefined, workspaceRoot)),
	)
}

import path from "node:path"
import type { DiscoveredTool } from "@/core/task/tools/discovery/DiscoveredTool"
import { refreshToolRegistryForWorkspace } from "@/core/task/tools/registry/refreshToolRegistry"
import { isDiscoveredToolAvailableToTaskProfile } from "@/core/task/TaskExecutionProfile"
import { initializeCli } from "../init"
import type { InitOptions } from "../types"
import { disposeCliContext, drainStdout } from "../utils/cleanup"

export interface ToolConfiguration {
	enabledToolIds: string[]
	disabledToolIds: string[]
}

export function createToolConfiguration(
	allTools: readonly DiscoveredTool[],
	enabledTools: readonly DiscoveredTool[],
): ToolConfiguration {
	const enabledIds = new Set(enabledTools.map((tool) => tool.id))
	const configurableToolIds = allTools
		.filter(
			(tool) =>
				tool.source !== "task" &&
				tool.exposure.kind === "configurable" &&
				isDiscoveredToolAvailableToTaskProfile("standalone", tool),
		)
		.map((tool) => tool.id)
		.sort()

	return {
		enabledToolIds: configurableToolIds.filter((toolId) => enabledIds.has(toolId)),
		disabledToolIds: configurableToolIds.filter((toolId) => !enabledIds.has(toolId)),
	}
}

export function formatToolConfiguration(configuration: ToolConfiguration): string {
	return [
		"Current config:",
		"",
		`--enable-tool ${configuration.enabledToolIds.join(",")}`,
		`--disable-tool ${configuration.disabledToolIds.join(",")}`,
	].join("\n")
}

export async function listTools(options: Pick<InitOptions, "config" | "cwd">): Promise<never> {
	const workspacePath = path.resolve(options.cwd || process.cwd())
	const ctx = await initializeCli({ ...options, cwd: workspacePath, index: false })

	try {
		const workingConfiguration = ctx.controller.stateManager.captureEffectiveTaskConfiguration()
		const configuration = await refreshToolRegistryForWorkspace(
			{
				workspaceRoot: workspacePath,
				includeUserTools: true,
				toggles: workingConfiguration.settings.toolToggles || {},
			},
			(registry) =>
				createToolConfiguration(
					registry.getAllTools(undefined, workspacePath),
					registry.getEnabledTools(undefined, workspacePath),
				),
		)
		process.stdout.write(`${formatToolConfiguration(configuration)}\n`)
	} finally {
		await disposeCliContext(ctx)
		await drainStdout()
	}

	process.exit(0)
}

import * as path from "node:path"
import { getOrDiscoverSkills } from "@core/context/instructions/user-instructions/skills"
import { DiracToolSet, PromptRegistry } from "@core/prompts/system-prompt"
import type { SystemPromptContext } from "@core/prompts/system-prompt/types"
import { type ToolRequestSnapshot, validateToolRequestSnapshot } from "@core/task/tools/runtime/ToolSnapshot"
import { Logger } from "@shared/services/Logger"
import { filterSkillsByProviderCapabilities } from "@shared/skills"
import { DiracDefaultTool, DiracTool } from "@shared/tools"
import { HostRegistryInfo } from "@/registry"
import type { DiscoveredTool } from "../discovery/DiscoveredTool"
import { ToolRegistry } from "../registry/ToolRegistry"
import { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import type { SubagentRuntime, TaskConfig } from "../types/TaskConfig"
import { SubagentBuilder } from "./SubagentBuilder"

// Builds the system prompt context and tool request snapshot for subagent runs.
export class SubagentContextBuilder {
	constructor(
		private baseConfig: TaskConfig,
		private agent: SubagentBuilder,
		private allowedTools: string[],
		private runtime: SubagentRuntime,
	) { }

	// Builds the full system prompt context for the subagent run.
	async buildContext(): Promise<{
		context: SystemPromptContext
		systemPrompt: string
		requestSnapshot: ToolRequestSnapshot
		useNativeToolCalls: boolean
	}> {
		const mode = this.baseConfig.mode
		const runtime = this.runtime
		const providerId = this.agent.getProviderId()
		const providerInfo = {
			providerId,
			phone: undefined,
			model: structuredClone(runtime.model) as any,
			mode,
			customPrompt: this.baseConfig.customPrompt,
			supportsNativeWebSearch: runtime.supportsNativeWebSearch,
		}
		const host = HostRegistryInfo.get()
		const availableSkills = await getOrDiscoverSkills(this.baseConfig.cwd, this.baseConfig.taskState)
		const providerSkills = filterSkillsByProviderCapabilities(availableSkills, {
			native_web_search: providerInfo.supportsNativeWebSearch,
		})
		const skills = this.resolveSkills(providerSkills)
		const context: SystemPromptContext = {
			providerInfo,
			cwd: this.baseConfig.cwd,
			ide: host?.platform || "Unknown",
			skills,
			browserSettings: this.baseConfig.browserSettings,
			yoloModeToggled: false,
			lowVerbosityEnabled: this.baseConfig.lowVerbosityEnabled,
			isSubagentRun: true,
			isMultiRootEnabled: this.baseConfig.isMultiRootEnabled,
			workspaceRoots: this.baseConfig.workspaceManager
				?.getRoots()
				.map((root) => ({ path: root.path, name: root.name || path.basename(root.path), vcs: root.vcs })),
		}
		const requestSnapshot = await this.buildSubagentRequestSnapshot(context)
		const promptRegistry = PromptRegistry.getInstance()
		const generatedSystemPrompt = await promptRegistry.get(context, requestSnapshot)
		const systemPrompt = this.agent.buildSystemPrompt(generatedSystemPrompt)
		return { context, systemPrompt, requestSnapshot, useNativeToolCalls: requestSnapshot.nativeTools.length > 0 }
	}

	// Tells the model about the same hard deadline enforced by SubagentRunner.
	appendExecutionDeadline(systemPrompt: string, timeoutSeconds: number): string {
		return (
			systemPrompt +
			`\n\n# Execution Deadline\nYou must complete your task and call respond with operation "complete" within ${timeoutSeconds} seconds.`
		)
	}

	private resolveSkills(availableSkills: any[]): any[] {
		const configuredSkillNames = this.agent.getConfiguredSkills()
		if (configuredSkillNames === undefined) return availableSkills
		return configuredSkillNames
			.map((skillName) => {
				const skill = availableSkills.find((candidate) => candidate.name === skillName)
				if (!skill) Logger.warn(`[SubagentRunner] Configured skill '${skillName}' not found for subagent run.`)
				return skill
			})
			.filter((skill): skill is any => Boolean(skill))
	}

	async buildSubagentRequestSnapshot(context: SystemPromptContext): Promise<ToolRequestSnapshot> {
		const parentSnapshot = this.baseConfig.activeToolSnapshot
		const workspaceRoot = this.baseConfig.workspaceManager?.getPrimaryRoot()?.path
		const activeSkillIds = new Set(parentSnapshot?.activeSkillIds ?? this.baseConfig.taskState.activeSkillIds)
		const activeSkills = this.baseConfig.taskState.availableSkills.filter((skill) => activeSkillIds.has(skill.name))
		const { parentTools, skillTools } = parentSnapshot
			? { parentTools: parentSnapshot.inventoryEnabledTools, skillTools: [] as DiscoveredTool[] }
			: await ToolRegistry.withExclusiveAccess((registry) => ({
				parentTools: registry.getEnabledTools(this.baseConfig.taskId, workspaceRoot),
				skillTools: registry.resolveSkillDependencyTools(activeSkills, this.baseConfig.taskId, workspaceRoot),
			}))
		const enabledTools = this.mergeTools(parentTools, skillTools)
		const registry = ToolRegistry.getInstance()
		const allowedEnabledTools = enabledTools
			.map((tool) => registry.scopeToolForSubagent(tool, this.allowedTools))
			.filter((tool): tool is DiscoveredTool => Boolean(tool))
		const contextFilteredSpecs = allowedEnabledTools
			.map((tool) => tool.spec)
			.filter((spec) => !spec.contextRequirements || spec.contextRequirements(context))
		const promptVisibleSpecs = DiracToolSet.withDynamicSubagentToolSpecs(contextFilteredSpecs, context).filter(
			(spec) => spec.id !== DiracDefaultTool.USE_SUBAGENTS || this.allowedTools.includes(spec.name),
		)
		const coordinator = this.buildSubagentCoordinator(allowedEnabledTools)
		const nativeTools = DiracToolSet.convertSpecsToNativeTools(promptVisibleSpecs, context)
		const snapshot = subagentToolSnapshot(
			promptVisibleSpecs,
			nativeTools,
			allowedEnabledTools,
			activeSkills.map((skill) => skill.name),
			coordinator,
		)
		validateToolRequestSnapshot(snapshot)
		return snapshot
	}

	private mergeTools(baseTools: readonly DiscoveredTool[], skillTools: readonly DiscoveredTool[]): DiscoveredTool[] {
		const tools = new Map(baseTools.map((tool) => [tool.id, tool]))
		for (const tool of skillTools) tools.set(tool.id, tool)
		return [...tools.values()]
	}
	private buildSubagentCoordinator(enabledTools: DiscoveredTool[]): ToolExecutorCoordinator {
		const coordinator = this.baseConfig.coordinator.createEmptySibling()
		for (const tool of enabledTools) coordinator.registerModularTool(tool.factory(this.baseConfig))
		return coordinator
	}

	isDiscoveredToolAllowed(tool: DiscoveredTool): boolean {
		return Boolean(ToolRegistry.getInstance().scopeToolForSubagent(tool, this.allowedTools))
	}
}

function subagentToolSnapshot(
	promptVisibleSpecs: ToolRequestSnapshot["promptVisibleSpecs"],
	nativeTools: DiracTool[],
	inventoryEnabledTools: readonly DiscoveredTool[],
	activeSkillIds: readonly string[],
	coordinator: ToolExecutorCoordinator,
): ToolRequestSnapshot {
	return {
		inventoryVersion: 0,
		requestId: "subagent",
		promptVisibleSpecs,
		inventoryEnabledTools,
		activeSkillIds,
		nativeTools,
		coordinator,
		executableToolNames: new Set(promptVisibleSpecs.map((spec) => spec.name)),
		dynamicSubagentToolNames: new Set(),
	}
}

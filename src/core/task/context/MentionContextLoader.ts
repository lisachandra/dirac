import { parseMentions } from "@core/mentions"
import { parseSlashCommands, type SlashCommandDirectAction } from "@core/slash-commands"
import { SkillMetadata } from "@/shared/skills"
import { refreshToolRegistryForWorkspace } from "../tools/registry/refreshToolRegistry"
import { ToolRegistry } from "../tools/registry/ToolRegistry"
import { FileContextLoader } from "./FileContextLoader"
import { ContextLoaderDependencies } from "../types/context-loader"

export interface EnrichContextResult {
	enrichedText: string
	needsDiracrulesFileCheck: boolean
	isDirectResponse?: boolean
	directResponseText?: string
	directAction?: SlashCommandDirectAction
}

export class MentionContextLoader {
	constructor(
		private dependencies: ContextLoaderDependencies,
		private fileContextLoader: FileContextLoader,
	) { }

	// Parse mentions and slash commands, then optionally enrich with file/symbol context
	async enrichContext(
		text: string,
		cwd: string,
		localWorkflowToggles: any,
		globalWorkflowToggles: any,
		ulid: string,
		providerInfo: any,
		includePathContext: boolean,
		availableSkills: SkillMetadata[],
		conversationCondensationAvailable: boolean,
		taskHandoffCondensationAvailable: boolean,
	): Promise<EnrichContextResult> {
		const parsedText = await parseMentions(text, cwd, this.urlContentFetcher, this.fileContextTracker, this.workspaceManager)
		const { processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction } =
			await parseSlashCommands(
				parsedText,
				localWorkflowToggles,
				globalWorkflowToggles,
				ulid,
				providerInfo,
				availableSkills,
				this.dependencies.commandPermissionController,
				this.dependencies.extensionPath,
				this.dependencies.sourceDir,
				conversationCondensationAvailable,
				taskHandoffCondensationAvailable,
			)

		// Handle /reloadtools direct response: trigger tool registry refresh
		if (isDirectResponse && directResponseText === "__RELOAD_TOOLS__") return await this.handleReloadTools()

		// Skip automatic path and symbol detection for subsequent turns or very long prompts
		if (!includePathContext || text.length > 1000)
			return { enrichedText: processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction }

		const { filePaths, directoryPaths, symbols } = await this.fileContextLoader.extractContext(text, cwd)
		const { skeletons, directoryLists } = await this.fileContextLoader.getPathContext(filePaths, directoryPaths, cwd)
		const symbolDefinitions = await this.fileContextLoader.getSymbolContext(symbols, cwd)

		const additionalContext = [...skeletons, ...directoryLists, ...symbolDefinitions]
		if (additionalContext.length > 0) {
			return {
				enrichedText: `${processedText}\n\n${additionalContext.join("\n\n")}`,
				needsDiracrulesFileCheck,
				isDirectResponse,
				directResponseText,
				directAction,
			}
		}
		return { enrichedText: processedText, needsDiracrulesFileCheck, isDirectResponse, directResponseText, directAction }
	}

	// Refresh tool registry and build a summary response for /reloadtools
	private async handleReloadTools(): Promise<EnrichContextResult> {
		const primaryRootPath = this.workspaceManager?.getPrimaryRoot()?.path
		await refreshToolRegistryForWorkspace({
			workspaceRoot: primaryRootPath,
			includeUserTools: true,
			forceRefresh: true,
		})
		const reloadResponse = await ToolRegistry.withExclusiveAccess((registry) => {
			const allTools = registry.getAllTools()
			const userTools = allTools.filter((tool) => tool.source !== "builtin")
			const enabledTools = registry.getEnabledTools()
			const userToolSummary =
				userTools.length > 0
					? userTools
						.map(
							(tool) =>
								`  - ${tool.id} (${tool.source}) — ${enabledTools.some((enabled) => enabled.id === tool.id) ? "enabled" : "disabled"}`,
						)
						.join("\n")
					: "  (none found)"
			return [
				`Tools reloaded. Found ${allTools.length} total tools (${userTools.length} user tools).`,
				"",
				"User tools:",
				userToolSummary,
				"",
				"Note: User tools are disabled by default. Enable them in Settings → Tools or by toggling the switch.",
			].join("\n")
		})
		await this.dependencies.postStateToWebview()
		return { enrichedText: "", needsDiracrulesFileCheck: false, isDirectResponse: true, directResponseText: reloadResponse }
	}

	private get urlContentFetcher() {
		return this.dependencies.urlContentFetcher
	}
	private get fileContextTracker() {
		return this.dependencies.fileContextTracker
	}
	private get workspaceManager() {
		return this.dependencies.workspaceManager
	}
}

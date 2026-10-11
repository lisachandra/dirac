import { GlobalFileNames } from "@core/storage/disk"
import { USER_CONTENT_TAGS } from "@shared/messages/constants"
import { DiracContent, DiracTextContentBlock } from "@shared/messages/content"
import { filterSkillsByProviderCapabilities, SkillMetadata } from "@/shared/skills"
import { ensureLocalDiracDirExists } from "../context/instructions/user-instructions/rule-helpers"
import { getOrDiscoverSkills } from "../context/instructions/user-instructions/skills"
import { refreshWorkflowToggles } from "../context/instructions/user-instructions/workflows"
import { FileContextLoader } from "./context/FileContextLoader"
import { MentionContextLoader } from "./context/MentionContextLoader"
import { ContextLoaderDependencies } from "./types/context-loader"
import { CONVERSATION_CONTINUATION_TEMPLATE_ID, TASK_HANDOFF_TEMPLATE_ID } from "@core/text-condensation/templates"
import type { SlashCommandDirectAction } from "@core/slash-commands"

export class ContextLoader {
	private fileContextLoader: FileContextLoader
	private mentionContextLoader: MentionContextLoader

	constructor(private dependencies: ContextLoaderDependencies) {
		this.fileContextLoader = new FileContextLoader(dependencies)
		this.mentionContextLoader = new MentionContextLoader(dependencies, this.fileContextLoader)
	}

	// Load and enrich context for all user content blocks, returning processed content, env details, skills, and direct response info
	async loadContext(
		userContent: DiracContent[],
		includeFileDetails = false,
		useCompactPrompt = false,
	): Promise<[DiracContent[], string, boolean, SkillMetadata[], boolean, string?, SlashCommandDirectAction[]?]> {
		const cwd = this.dependencies.cwd
		const runtime = this.dependencies.getRequestRuntime()
		const { settings, workspaceConfiguration } = runtime.workingConfiguration
		const { localWorkflowToggles, globalWorkflowToggles } = await refreshWorkflowToggles(
			this.dependencies.stateManager,
			cwd,
			{
				globalWorkflowToggles: settings.globalWorkflowToggles,
				localWorkflowToggles: workspaceConfiguration.workflowToggles,
			},
		)

		// Discover and filter skills by toggles
		const availableSkills = await this.resolveAvailableSkills(cwd)
		this.dependencies.taskState.availableSkills = availableSkills

		type ParsedTextMetadata = {
			needsDiracrulesFileCheck: boolean
			isDirectResponse: boolean
			directResponseText?: string
			directAction?: SlashCommandDirectAction
		}
		const parsedTextMetadata: Array<ParsedTextMetadata | undefined> = []
		const conversationCondensationAvailable =
			this.dependencies.isTextCondensationAvailable?.(CONVERSATION_CONTINUATION_TEMPLATE_ID) ?? false
		const taskHandoffCondensationAvailable =
			this.dependencies.isTextCondensationAvailable?.(TASK_HANDOFF_TEMPLATE_ID) ?? false

		// Parse a single text block through mention/slash enrichment and retain metadata by input order.
		const parseTextBlock = async (text: string, blockIndex: number): Promise<string> => {
			const result = await this.mentionContextLoader.enrichContext(
				text,
				cwd,
				localWorkflowToggles,
				globalWorkflowToggles,
				this.dependencies.ulid,
				this.dependencies.getCurrentProviderInfo(),
				includeFileDetails,
				availableSkills,
				conversationCondensationAvailable,
				taskHandoffCondensationAvailable,
			)
			parsedTextMetadata[blockIndex] = {
				needsDiracrulesFileCheck: result.needsDiracrulesFileCheck,
				isDirectResponse: result.isDirectResponse ?? false,
				directResponseText: result.directResponseText,
				directAction: result.directAction,
			}
			return result.enrichedText
		}

		// Process all content and environment details in parallel.
		const [processedUserContent, environmentDetails] = await Promise.all([
			Promise.all(
				userContent.map((block, blockIndex) =>
					this.processContentBlock(block, (text) => parseTextBlock(text, blockIndex)),
				),
			),
			this.dependencies.getEnvironmentDetails(includeFileDetails),
		])
		const parsedResults = parsedTextMetadata.filter((result): result is ParsedTextMetadata => result !== undefined)
		const needsDiracrulesFileCheck = parsedResults.some((result) => result.needsDiracrulesFileCheck)
		const lastDirectResponse = [...parsedResults].reverse().find((result) => result.isDirectResponse)
		const directActions = parsedResults.flatMap((result) => (result.directAction ? [result.directAction] : []))

		const diracrulesError = needsDiracrulesFileCheck
			? await ensureLocalDiracDirExists(this.dependencies.cwd, GlobalFileNames.diracRules)
			: false

		return [
			processedUserContent,
			environmentDetails,
			diracrulesError,
			availableSkills,
			lastDirectResponse !== undefined,
			lastDirectResponse?.directResponseText,
			directActions.length > 0 ? directActions : undefined,
		]
	}

	// Discover skills and filter by global/local toggles
	private async resolveAvailableSkills(cwd: string): Promise<SkillMetadata[]> {
		const resolvedSkills = await getOrDiscoverSkills(cwd, this.dependencies.taskState)
		const providerSkills = filterSkillsByProviderCapabilities(resolvedSkills, {
			native_web_search: this.dependencies.getCurrentProviderInfo().supportsNativeWebSearch === true,
		})
		const { settings, workspaceConfiguration } = this.dependencies.getRequestRuntime().workingConfiguration
		const globalToggles = settings.globalSkillsToggles ?? {}
		const localToggles = workspaceConfiguration.localSkillsToggles ?? {}
		return providerSkills.filter((skill) => {
			if (settings.yoloModeToggled && skill.interactiveOnly) return false
			if (skill.source === "builtin") return true
			const toggles = skill.source === "global" ? globalToggles : localToggles
			return toggles[skill.path] !== false
		})
	}

	// Only explicitly marked user input may enter mention/slash enrichment. Every other
	// block is machine-generated or attached context and must remain inert.
	private async processContentBlock(
		block: DiracContent,
		parseTextBlock: (text: string) => Promise<string>,
	): Promise<DiracContent> {
		if (block.type === "text") return this.processTextContent(block, parseTextBlock)
		return block
	}

	// Process only explicitly marked user text containing a supported user-content tag.
	// Remove the transient marker before returning content for persistence/provider dispatch.
	private async processTextContent(
		block: DiracTextContentBlock,
		parseTextBlock: (text: string) => Promise<string>,
	): Promise<DiracTextContentBlock> {
		const { isUserInput, ...contentBlock } = block
		if (!isUserInput || !this.hasUserContentTag(block.text)) return contentBlock
		const processedText = await parseTextBlock(block.text)
		return { ...contentBlock, text: processedText }
	}

	private hasUserContentTag(text: string): boolean {
		return USER_CONTENT_TAGS.some((tag: string) => text.includes(tag))
	}
}

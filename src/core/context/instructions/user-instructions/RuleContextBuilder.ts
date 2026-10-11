import type { DiracMessage } from "@shared/ExtensionMessage"
import { HostProvider } from "@/hosts/host-provider"
import type { DiracStorageMessage } from "@/shared/messages/content"
import { extractPathLikeStrings, RuleEvaluationContext, toWorkspaceRelativePosixPath } from "./rule-conditionals"

type WorkspaceRoot = { path: string }
type WorkspaceManagerLike = { getRoots(): WorkspaceRoot[] }

type DiracMessageLike = DiracMessage

type MessageStateHandlerLike = {
	getDiracMessages(): DiracMessageLike[]
	getApiConversationHistory(): DiracStorageMessage[]
}

export type RuleContextBuilderDeps = {
	cwd: string
	messageStateHandler: MessageStateHandlerLike
	workspaceManager?: WorkspaceManagerLike
}

/**
 * Builds the evaluation context used for conditional Dirac Rules (e.g. YAML frontmatter `paths:`).
 *
 * Kept in the user-instructions domain so Task remains orchestration-focused.
 *
 * Path context is gathered from structured sources:
 * - The latest user-authored message
 * - Visible/open tabs
 * - Tool call inputs from API conversation history
 * - File locations and diffs attached to tool cards
 */
export class RuleContextBuilder {
	/**
	 * Maximum number of path candidates to consider for rule activation.
	 * This cap prevents performance degradation in long-running tasks with many file operations.
	 */
	readonly MAX_RULE_PATH_CANDIDATES = 100

	async buildEvaluationContext(deps: RuleContextBuilderDeps): Promise<RuleEvaluationContext> {
		return {
			paths: await this.getRulePathContext(deps),
		}
	}

	private async getRulePathContext(deps: RuleContextBuilderDeps): Promise<string[]> {
		const candidates: string[] = []
		const diracMessages = deps.messageStateHandler.getDiracMessages()

		const lastUserMessage = [...diracMessages]
			.reverse()
			.find((message) => message.content.type === "markdown" && message.content.role === "user")
		if (lastUserMessage?.content.type === "markdown") {
			candidates.push(...extractPathLikeStrings(lastUserMessage.content.content))
		}

		const roots = deps.workspaceManager?.getRoots().map((root) => root.path) ?? [deps.cwd]
		const visiblePaths = (await HostProvider.window.getVisibleTabs({}))?.paths ?? []
		const openPaths = (await HostProvider.window.getOpenTabs({}))?.paths ?? []
		for (const absolutePath of [...visiblePaths, ...openPaths]) {
			for (const root of roots) {
				const relativePath = toWorkspaceRelativePosixPath(absolutePath, root)
				if (!relativePath) continue
				candidates.push(relativePath)
				break
			}
		}

		for (const message of deps.messageStateHandler.getApiConversationHistory()) {
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue
			for (const block of message.content) {
				if (block.type !== "tool_use") continue
				candidates.push(...this.pathsFromToolInput(block.input))
			}
		}

		for (const message of diracMessages) {
			if (message.content.type !== "card") continue
			for (const location of message.content.card.locations ?? []) candidates.push(location.path)
			for (const diff of message.content.card.diffs ?? []) candidates.push(diff.path)
		}

		return this.normalizePaths(candidates)
	}

	private pathsFromToolInput(input: unknown): string[] {
		if (!this.isRecord(input)) return []

		const paths: string[] = []
		for (const key of ["path", "file_path", "filePath"]) {
			const value = input[key]
			if (typeof value === "string") paths.push(value)
		}

		const pathList = input.paths
		if (Array.isArray(pathList)) {
			for (const value of pathList) {
				if (typeof value === "string") paths.push(value)
			}
		}

		for (const key of ["files", "targets"]) {
			const entries = input[key]
			if (!Array.isArray(entries)) continue
			for (const entry of entries) paths.push(...this.pathsFromToolInput(entry))
		}

		return paths
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value)
	}

	private normalizePaths(candidates: string[]): string[] {
		const seen = new Set<string>()
		const normalized: string[] = []
		for (const candidate of candidates) {
			const posixPath = candidate.replace(/\\/g, "/").replace(/^\//, "")
			if (!posixPath || posixPath === "/" || seen.has(posixPath)) continue
			seen.add(posixPath)
			normalized.push(posixPath)
			if (normalized.length >= this.MAX_RULE_PATH_CANDIDATES) break
		}
		return normalized.sort()
	}
}

import type {
	AstImplementationTargetResult,
	SourceDefinition,
	SourceLine,
	SourceOccurrence,
} from "@services/source-ast/types"
import { getDelimiter } from "@utils/line-hashing"
import type {
	InspectAstImplementationGroup,
	InspectAstIssue,
	InspectAstOccurrenceGroup,
	InspectAstOutlineGroup,
	InspectAstResultGroup,
} from "./InspectAstResultReducer"

const RESULT_SEPARATOR = "\n\n---\n\n"

export interface ImplementationCacheRecord {
	contentHash: string
	anchorFingerprint?: string
}

export interface InspectAstCacheStats {
	hitCount: number
	missCount: number
}

export interface InspectAstSummary {
	resultCount: number
	successCount: number
	failureCount: number
	issueCount: number
	mixedResult: boolean
}

export interface FormattedInspectAstResult {
	text: string
	summary: InspectAstSummary
	cacheStats: InspectAstCacheStats
}

export function implementationCacheKey(target: AstImplementationTargetResult): string {
	const normalizedPath = (target.absolutePath ?? target.path).replace(/\\/g, "/")
	return `${normalizedPath}::${target.symbol}#plain`
}

function formatLine(line: SourceLine, includeAnchors: boolean): string {
	return includeAnchors && line.anchor ? `${line.anchor}${getDelimiter()}${line.text}` : line.text
}

function describeDefinition(definition: SourceDefinition, line: SourceLine | undefined, includeAnchors: boolean): string {
	const declaration = line ? formatLine(line, includeAnchors) : definition.declarationText
	if (definition.calls.length === 0) return declaration
	return `${declaration}\n${definition.indentation}calls: ${definition.calls.join(", ")}`
}

function summaryFromGroups(groups: InspectAstResultGroup[]): InspectAstSummary {
	const successCount = groups.filter((group) => group.status === "success").length
	const failureCount = groups.length - successCount
	return {
		resultCount: groups.length,
		successCount,
		failureCount,
		issueCount: groups.reduce((count, group) => count + group.issues.length, 0),
		mixedResult: successCount > 0 && failureCount > 0,
	}
}

/** Formats reduced AST result groups into concise model-facing source output. */
export class InspectAstFormatter {
	public formatOutline(groups: InspectAstOutlineGroup[], includeAnchors: boolean): FormattedInspectAstResult {
		const sections = groups.map((group) => {
			if (group.status === "failure") {
				return this.formatFailure(group.path, "no definitions found", [], group.issues)
			}

			const sourceLines = new Map(group.file!.lines.map((line) => [line.lineNumber, line]))
			const definitions = group.file!.definitions.map((definition) =>
				describeDefinition(definition, sourceLines.get(definition.declarationLine + 1), includeAnchors),
			)
			const lines = [group.path, ...definitions]
			this.appendIssueMessages(lines, group.issues)
			return lines.join("\n")
		})
		return this.document(groups, sections, { hitCount: 0, missCount: 0 })
	}

	public formatImplementations(
		groups: InspectAstImplementationGroup[],
		includeAnchors: boolean,
		cache: Record<string, ImplementationCacheRecord | string>,
		_fingerprintForPath: (path: string) => string | null,
	): FormattedInspectAstResult {
		const cacheStats: InspectAstCacheStats = { hitCount: 0, missCount: 0 }
		const sections = groups.map((group) => {
			if (group.status === "failure") {
				return this.formatFailure(group.symbol, "no implementation found", group.searchedPaths, group.issues)
			}

			const matches = group.matches.map((match) =>
				this.formatImplementationMatch(match, includeAnchors, cache, cacheStats),
			)
			const lines = [matches.join(RESULT_SEPARATOR)]
			if (group.issues.length > 0) lines.push("")
			this.appendIssueMessages(lines, group.issues)
			return lines.join("\n")
		})
		return this.document(groups, sections, cacheStats)
	}

	public formatOccurrences(
		groups: InspectAstOccurrenceGroup[],
		operation: InspectAstOccurrenceGroup["operation"],
		includeAnchors: boolean,
	): FormattedInspectAstResult {
		const includeSymbol = groups.length > 1
		const sections = groups.map((group) => {
			if (group.status === "failure") {
				return this.formatFailure(group.symbol, this.missingOccurrenceMessage(operation), group.searchedPaths, group.issues)
			}

			const occurrencesByPath = new Map<string, SourceOccurrence[]>()
			for (const occurrence of group.occurrences) {
				const occurrences = occurrencesByPath.get(occurrence.displayPath) ?? []
				occurrences.push(occurrence)
				occurrencesByPath.set(occurrence.displayPath, occurrences)
			}

			const lines = includeSymbol ? [group.symbol] : []
			for (const [path, occurrences] of occurrencesByPath) {
				if (lines.length > 0) lines.push("")
				lines.push(path)
				for (const occurrence of occurrences) {
					const location = `  ${occurrence.kind} ${occurrence.startLine + 1}:${occurrence.startColumn + 1}`
					if (includeAnchors && occurrence.anchor) {
						lines.push(location, `${occurrence.anchor}${getDelimiter()}${occurrence.sourceLine ?? ""}`)
					} else {
						lines.push(`${location} ${occurrence.sourceLine ?? ""}`.trimEnd())
					}
				}
			}
			this.appendIssueMessages(lines, group.issues)
			return lines.join("\n")
		})
		return this.document(groups, sections, { hitCount: 0, missCount: 0 })
	}

	private formatImplementationMatch(
		target: AstImplementationTargetResult,
		includeAnchors: boolean,
		cache: Record<string, ImplementationCacheRecord | string>,
		cacheStats: InspectAstCacheStats,
	): string {
		const definition = target.definition!
		const contentHash = target.contentHash!
		const header = `${target.path}::${definition.qualifiedName}`
		const cacheKey = implementationCacheKey(target)
		const cached = includeAnchors ? undefined : cache[cacheKey]
		const contentMatches = typeof cached === "string"
			? cached === contentHash
			: cached?.contentHash === contentHash

		if (!includeAnchors && contentMatches) {
			cacheStats.hitCount++
			return `${header}\nunchanged`
		}

		cacheStats.missCount++
		if (!includeAnchors) cache[cacheKey] = { contentHash }
		const context = (target.contextLines ?? []).map((line) => formatLine(line, includeAnchors)).join("\n")
		const implementation = (target.lines ?? []).map((line) => formatLine(line, includeAnchors)).join("\n")
		if (!context) return `${header}\n${implementation}`
		return `${header}\ncontext:\n${context}\nimplementation:\n${implementation}`
	}

	private missingOccurrenceMessage(operation: InspectAstOccurrenceGroup["operation"]): string {
		if (operation === "definitions") return "no definitions found"
		if (operation === "references") return "no references found"
		return "no definitions or references found"
	}

	private formatFailure(subject: string, message: string, paths: string[], issues: InspectAstIssue[]): string {
		if (issues.length > 0) return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")
		const location = paths.length > 0 ? ` in ${paths.join(", ")}` : ""
		return `${subject}: ${message}${location}`
	}

	private appendIssueMessages(lines: string[], issues: InspectAstIssue[]): void {
		if (issues.length === 0) return
		for (const issue of issues) lines.push(`${issue.path}: ${issue.message}`)
	}

	private document(
		groups: InspectAstResultGroup[],
		sections: string[],
		cacheStats: InspectAstCacheStats,
	): FormattedInspectAstResult {
		return {
			text: sections.join(RESULT_SEPARATOR),
			summary: summaryFromGroups(groups),
			cacheStats,
		}
	}
}

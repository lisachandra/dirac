import { strict as assert } from "node:assert"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "mocha"

type ConfigurationAccessor = "getGlobalSettingsKey" | "getApiConfiguration" | "getWorkspaceStateKey"

type AccessorOccurrence = {
	file: string
	line: number
	accessor: ConfigurationAccessor
	sourceLine: string
}

type AllowedOccurrence = {
	file: string
	accessor: ConfigurationAccessor
	sourceLine: RegExp
	reason: string
}

const TASK_ROOT = path.resolve(__dirname, "..")
const ACCESSOR_PATTERN = /\.\s*(getGlobalSettingsKey|getApiConfiguration|getWorkspaceStateKey)\s*\(/g

/**
 * These are persistence/live-data adapters, not task working-configuration reads.
 *
 * Keep this list exact and small. An entry must describe one recognizable source
 * line and is required to match exactly once, so deleting or duplicating an
 * exception fails this test until the allowlist is deliberately tightened.
 */
const ALLOWED_PERSISTENCE_ONLY_OCCURRENCES: readonly AllowedOccurrence[] = [
	{
		file: "tools/context/DiracContext.ts",
		accessor: "getWorkspaceStateKey",
		sourceLine: /getWorkspaceStateKey\(key as any\)/,
		reason:
			"DiracContext exposes conversation-scoped dynamic workspace data; it does not resolve operational task configuration.",
	},
]

function productionTypeScriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "__tests__") return []
		const absolutePath = path.join(directory, entry.name)
		if (entry.isDirectory()) return productionTypeScriptFiles(absolutePath)
		if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) {
			return []
		}
		return [absolutePath]
	})
}

function findConfigurationAccessorOccurrences(): AccessorOccurrence[] {
	return productionTypeScriptFiles(TASK_ROOT).flatMap((absolutePath) => {
		const source = readFileSync(absolutePath, "utf8")
		const relativePath = path.relative(TASK_ROOT, absolutePath).split(path.sep).join("/")
		const occurrences: AccessorOccurrence[] = []

		for (const match of source.matchAll(ACCESSOR_PATTERN)) {
			const accessor = match[1] as ConfigurationAccessor
			const accessorOffset = match[0].indexOf(accessor)
			const accessorIndex = (match.index ?? 0) + accessorOffset
			const line = source.slice(0, accessorIndex).split("\n").length
			const sourceLine = source.split("\n")[line - 1]?.trim() ?? ""
			occurrences.push({ file: relativePath, line, accessor, sourceLine })
		}

		return occurrences
	})
}

function matchingAllowlistEntries(occurrence: AccessorOccurrence): AllowedOccurrence[] {
	return ALLOWED_PERSISTENCE_ONLY_OCCURRENCES.filter(
		(allowed) =>
			allowed.file === occurrence.file &&
			allowed.accessor === occurrence.accessor &&
			allowed.sourceLine.test(occurrence.sourceLine),
	)
}

function formatOccurrence(occurrence: AccessorOccurrence): string {
	return `${occurrence.file}:${occurrence.line} ${occurrence.accessor} — ${occurrence.sourceLine}`
}

describe("Task working-configuration architecture", () => {
	it("has no live StateManager operational configuration reads", () => {
		const occurrences = findConfigurationAccessorOccurrences()
		const violations = occurrences.filter((occurrence) => matchingAllowlistEntries(occurrence).length === 0)
		const malformedAllowlistMatches = occurrences.filter((occurrence) => matchingAllowlistEntries(occurrence).length > 1)
		const staleAllowlistEntries = ALLOWED_PERSISTENCE_ONLY_OCCURRENCES.filter(
			(allowed) =>
				occurrences.filter(
					(occurrence) =>
						occurrence.file === allowed.file &&
						occurrence.accessor === allowed.accessor &&
						allowed.sourceLine.test(occurrence.sourceLine),
				).length !== 1,
		)

		const failures: string[] = []
		if (violations.length > 0) {
			failures.push(
				"Operational Task code must read its TaskWorkingConfiguration/TaskRequestRuntime, not mutable StateManager configuration:\n" +
					violations.map((occurrence) => `  - ${formatOccurrence(occurrence)}`).join("\n"),
			)
		}
		if (malformedAllowlistMatches.length > 0) {
			failures.push(
				"Occurrences matched more than one persistence-only allowlist entry:\n" +
					malformedAllowlistMatches.map((occurrence) => `  - ${formatOccurrence(occurrence)}`).join("\n"),
			)
		}
		if (staleAllowlistEntries.length > 0) {
			failures.push(
				"Persistence-only allowlist entries must each match exactly one occurrence; remove stale entries rather than broadening them:\n" +
					staleAllowlistEntries
						.map((allowed) => `  - ${allowed.file} ${allowed.accessor}: ${allowed.reason}`)
						.join("\n"),
			)
		}

		assert.equal(failures.length, 0, failures.join("\n\n"))
	})
})

#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const VALID_KINDS = new Set(["patch", "minor", "major"])
const CURATED_KINDS = new Set(["minor", "major"])
const CATEGORY_PRIORITY = ["feat", "perf", "fix"]

function fail(message) {
	process.stderr.write(`${message}\n`)
	process.exit(1)
}

function parseArgs(argv) {
	const [command, ...rest] = argv
	const options = {}
	for (let index = 0; index < rest.length; index += 2) {
		const key = rest[index]
		const value = rest[index + 1]
		if (!key?.startsWith("--") || value === undefined) fail(`Invalid argument list near ${key ?? "<end>"}`)
		options[key.slice(2)] = value
	}
	return { command, options }
}

function requireOption(options, key) {
	const value = options[key]
	if (!value) fail(`Missing required option --${key}`)
	return value
}

function git(args, options = {}) {
	return execFileSync("git", args, { encoding: "utf8", ...options }).trim()
}

function readDocument(filePath) {
	let value
	try {
		value = JSON.parse(fs.readFileSync(filePath, "utf8"))
	} catch (error) {
		fail(`Cannot read release-note document ${filePath}: ${error.message}`)
	}
	return value
}

function writeDocument(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	const temporaryPath = `${filePath}.tmp.${process.pid}`
	fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
	fs.renameSync(temporaryPath, filePath)
}

function parseConventionalCommit(line) {
	const tab = line.indexOf("\t")
	if (tab < 1) return undefined
	const commit = line.slice(0, tab)
	const subject = line.slice(tab + 1)
	const match = /^(feat|perf|fix)(?:\(([^)]+)\))?!?:\s+(.+)$/i.exec(subject)
	if (!match) return undefined
	return {
		commit,
		category: match[1].toLowerCase(),
		scope: match[2],
		title: match[3].trim().replace(/\s+\(#\d+\)$/, ""),
	}
}

function generatePatch(options) {
	const version = requireOption(options, "version")
	const previousTag = requireOption(options, "previous-tag")
	const sourceRef = requireOption(options, "source-ref")
	const output = requireOption(options, "output")
	const analyzedCommit = git(["rev-parse", sourceRef])
	const range = `${previousTag}..${analyzedCommit}`
	const lines = git(["log", range, "--pretty=format:%H%x09%s", "--no-merges"]).split("\n").filter(Boolean)
	const commits = lines.map(parseConventionalCommit).filter(Boolean)
	const ordered = CATEGORY_PRIORITY.flatMap((category) => commits.filter((commit) => commit.category === category))
	const highlights = ordered.slice(0, 5).map((commit) => ({
		id: `${commit.category}-${commit.commit.slice(0, 8)}`,
		title: commit.title,
		category: commit.category,
		evidence: [commit.commit],
	}))

	writeDocument(output, {
		schemaVersion: 1,
		version,
		kind: "patch",
		announce: highlights.length > 0,
		sourceTag: previousTag,
		analyzedCommit,
		headline: "Updates and improvements",
		highlights,
	})
}

function validateCommon(document, expected) {
	if (document.schemaVersion !== 1) fail("Release notes must use schemaVersion 1")
	if (document.version !== expected.version) {
		fail(`Release-note version ${document.version ?? "<missing>"} does not match ${expected.version}`)
	}
	if (!VALID_KINDS.has(document.kind)) fail(`Invalid release-note kind: ${document.kind ?? "<missing>"}`)
	if (expected.kind && document.kind !== expected.kind) {
		fail(`Release-note kind ${document.kind} does not match ${expected.kind}`)
	}
	if (document.sourceTag !== expected.previousTag) {
		fail(`Release-note sourceTag ${document.sourceTag ?? "<missing>"} does not match ${expected.previousTag}`)
	}
	if (typeof document.analyzedCommit !== "string" || !/^[a-f0-9]{40}$/i.test(document.analyzedCommit)) {
		fail("Release notes must contain the full analyzedCommit SHA")
	}
	if (typeof document.headline !== "string" || !document.headline.trim()) fail("Release notes require a headline")
	if (!Array.isArray(document.highlights)) fail("Release notes require a highlights array")
	if (typeof document.announce !== "boolean") fail("Release notes require an announce boolean")

	const ids = new Set()
	for (const [index, highlight] of document.highlights.entries()) {
		if (!highlight || typeof highlight !== "object") fail(`Highlight ${index + 1} must be an object`)
		if (typeof highlight.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(highlight.id)) {
			fail(`Highlight ${index + 1} requires a stable kebab-case id`)
		}
		if (ids.has(highlight.id)) fail(`Duplicate highlight id: ${highlight.id}`)
		ids.add(highlight.id)
		if (typeof highlight.title !== "string" || !highlight.title.trim()) {
			fail(`Highlight ${highlight.id} requires a title`)
		}
		if (highlight.actions !== undefined) {
			if (!Array.isArray(highlight.actions)) fail(`Highlight ${highlight.id} actions must be an array`)
			for (const action of highlight.actions) {
				if (!action?.title || !action?.url) fail(`Highlight ${highlight.id} actions require title and url`)
				try {
					new URL(action.url)
				} catch {
					fail(`Highlight ${highlight.id} has an invalid action URL: ${action.url}`)
				}
			}
		}
	}

	if (document.fixes !== undefined && (!Array.isArray(document.fixes) || document.fixes.some((fix) => !fix?.trim?.()))) {
		fail("Release-note fixes must be an array of non-empty strings")
	}
}

function commitBelongsToRange(commit, previousTag, analyzedCommit) {
	try {
		git(["merge-base", "--is-ancestor", commit, analyzedCommit])
	} catch {
		return false
	}

	try {
		git(["merge-base", "--is-ancestor", commit, previousTag])
		return false
	} catch {
		return true
	}
}

function validateCurated(options) {
	const filePath = requireOption(options, "input")
	const version = requireOption(options, "version")
	const kind = requireOption(options, "kind")
	const previousTag = requireOption(options, "previous-tag")
	const head = git(["rev-parse", requireOption(options, "head")])
	if (!CURATED_KINDS.has(kind)) fail(`Curated validation only supports minor or major releases, not ${kind}`)
	const document = readDocument(filePath)
	validateCommon(document, { version, kind, previousTag })
	if (document.announce !== true) fail("Minor and major release notes must enable announcement")
	if (typeof document.summaryMd !== "string" || !document.summaryMd.trim()) {
		fail("Minor and major release notes require summaryMd")
	}
	if (document.highlights.length < 3 || document.highlights.length > 7) {
		fail("Minor and major release notes require 3 to 7 curated highlights")
	}
	for (const highlight of document.highlights) {
		if (typeof highlight.bodyMd !== "string" || !highlight.bodyMd.trim()) {
			fail(`Curated highlight ${highlight.id} requires bodyMd`)
		}
		if (!Array.isArray(highlight.evidence) || highlight.evidence.length === 0) {
			fail(`Curated highlight ${highlight.id} requires at least one evidence commit`)
		}
		for (const evidence of highlight.evidence) {
			let commit
			try {
				commit = git(["rev-parse", `${evidence}^{commit}`])
			} catch {
				fail(`Highlight ${highlight.id} references unknown commit ${evidence}`)
			}
			if (!commitBelongsToRange(commit, previousTag, document.analyzedCommit)) {
				fail(`Highlight ${highlight.id} evidence ${evidence} is outside ${previousTag}..${document.analyzedCommit}`)
			}
		}
	}

	try {
		git(["merge-base", "--is-ancestor", document.analyzedCommit, head])
	} catch {
		fail(`analyzedCommit ${document.analyzedCommit} is not an ancestor of ${head}`)
	}
	const changedPaths = git(["diff", "--name-only", `${document.analyzedCommit}..${head}`])
		.split("\n")
		.filter(Boolean)
	const normalizedInput = (options["document-path"] ?? filePath).replaceAll(path.sep, "/")
	const unexpectedPaths = changedPaths.filter((changedPath) => changedPath !== normalizedInput)
	if (unexpectedPaths.length > 0) {
		fail(
			`Curated release notes are stale; product files changed after analysis:\n${unexpectedPaths
				.map((changedPath) => `  - ${changedPath}`)
				.join("\n")}`,
		)
	}
}

function validatePatch(options) {
	const filePath = requireOption(options, "input")
	const version = requireOption(options, "version")
	const previousTag = requireOption(options, "previous-tag")
	const head = git(["rev-parse", requireOption(options, "head")])
	const document = readDocument(filePath)
	validateCommon(document, { version, kind: "patch", previousTag })
	if (document.highlights.length > 5) fail("Patch release notes may contain at most 5 highlights")
	if (document.announce !== document.highlights.length > 0) {
		fail("Patch release notes must announce exactly when they contain highlights")
	}
	for (const highlight of document.highlights) {
		if (!CATEGORY_PRIORITY.includes(highlight.category)) {
			fail(`Patch highlight ${highlight.id} requires a feat, perf, or fix category`)
		}
		if (!Array.isArray(highlight.evidence) || highlight.evidence.length === 0) {
			fail(`Patch highlight ${highlight.id} requires at least one evidence commit`)
		}
		for (const evidence of highlight.evidence) {
			let commit
			try {
				commit = git(["rev-parse", `${evidence}^{commit}`])
			} catch {
				fail(`Patch highlight ${highlight.id} references unknown commit ${evidence}`)
			}
			if (!commitBelongsToRange(commit, previousTag, document.analyzedCommit)) {
				fail(`Patch highlight ${highlight.id} evidence ${evidence} is outside ${previousTag}..${document.analyzedCommit}`)
			}
		}
	}
	try {
		git(["merge-base", "--is-ancestor", document.analyzedCommit, head])
	} catch {
		fail(`analyzedCommit ${document.analyzedCommit} is not an ancestor of ${head}`)
	}
	const changedPaths = git(["diff", "--name-only", `${document.analyzedCommit}..${head}`])
		.split("\n")
		.filter(Boolean)
	const normalizedInput = (options["document-path"] ?? filePath).replaceAll(path.sep, "/")
	const unexpectedPaths = changedPaths.filter((changedPath) => changedPath !== normalizedInput)
	if (unexpectedPaths.length > 0) {
		fail(
			`Patch release notes are stale; product files changed after analysis:\n${unexpectedPaths
				.map((changedPath) => `  - ${changedPath}`)
				.join("\n")}`,
		)
	}
}

function renderMarkdown(options) {
	const input = requireOption(options, "input")
	const output = requireOption(options, "output")
	const repository = requireOption(options, "repository")
	const document = readDocument(input)
	validateCommon(document, {
		version: requireOption(options, "version"),
		previousTag: requireOption(options, "previous-tag"),
	})
	const lines = [`## ${document.headline}`, ""]
	if (document.summaryMd) lines.push(document.summaryMd.trim(), "")
	if (document.highlights.length > 0) {
		lines.push("### Highlights", "")
		for (const highlight of document.highlights) {
			const body = highlight.bodyMd?.trim()
			lines.push(body ? `- **${highlight.title}** — ${body}` : `- ${highlight.title}`)
		}
		lines.push("")
	}
	if (document.fixes?.length) {
		lines.push("### Fixes and improvements", "", ...document.fixes.map((fix) => `- ${fix}`), "")
	}
	lines.push(`**Full Changelog**: https://github.com/${repository}/compare/${document.sourceTag}...v${document.version}`, "")
	fs.writeFileSync(output, `${lines.join("\n")}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
switch (command) {
	case "generate-patch":
		generatePatch(options)
		break
	case "validate-curated":
		validateCurated(options)
		break
	case "validate-patch":
		validatePatch(options)
		break
	case "render":
		renderMarkdown(options)
		break
	default:
		fail(`Unknown release-note command: ${command ?? "<missing>"}`)
}

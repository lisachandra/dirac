import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "mocha"

const releaseNotesScript = path.resolve(process.cwd(), "scripts/release-notes.mjs")
const temporaryRepositories: string[] = []

function git(repository: string, args: string[]): string {
	return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim()
}

function commitFile(repository: string, fileName: string, contents: string, subject: string): string {
	writeFileSync(path.join(repository, fileName), contents)
	git(repository, ["add", fileName])
	git(repository, ["commit", "-m", subject])
	return git(repository, ["rev-parse", "HEAD"])
}

function createMergedEvidenceRepository(): {
	repository: string
	previousCommit: string
	evidenceCommit: string
	analyzedCommit: string
} {
	const repository = mkdtempSync(path.join(tmpdir(), "dirac-release-notes-"))
	temporaryRepositories.push(repository)
	git(repository, ["init", "-b", "main"])
	git(repository, ["config", "user.email", "dirac@example.com"])
	git(repository, ["config", "user.name", "Dirac Tests"])
	commitFile(repository, "base.txt", "base\n", "chore: base")
	git(repository, ["branch", "evidence"])
	const previousCommit = commitFile(repository, "previous.txt", "previous\n", "chore: previous release")
	git(repository, ["tag", "v1.0.0"])
	git(repository, ["checkout", "evidence"])
	const evidenceCommit = commitFile(repository, "evidence.txt", "evidence\n", "fix: side-branch fix")
	git(repository, ["checkout", "main"])
	git(repository, ["merge", "--no-ff", "evidence", "-m", "Merge evidence"])
	const analyzedCommit = git(repository, ["rev-parse", "HEAD"])
	return { repository, previousCommit, evidenceCommit, analyzedCommit }
}

function validatePatch(repository: string, analyzedCommit: string, evidenceCommit: string) {
	const documentPath = path.join(repository, "release-notes.json")
	writeFileSync(
		documentPath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				version: "1.0.1",
				kind: "patch",
				announce: true,
				sourceTag: "v1.0.0",
				analyzedCommit,
				headline: "Updates and improvements",
				highlights: [
					{
						id: "side-branch-fix",
						title: "Side-branch fix",
						category: "fix",
						evidence: [evidenceCommit],
					},
				],
			},
			null,
			2,
		)}\n`,
	)
	return spawnSync(
		process.execPath,
		[
			releaseNotesScript,
			"validate-patch",
			"--input",
			documentPath,
			"--document-path",
			"release-notes.json",
			"--version",
			"1.0.1",
			"--previous-tag",
			"v1.0.0",
			"--head",
			analyzedCommit,
		],
		{ cwd: repository, encoding: "utf8" },
	)
}

describe("release-note evidence validation", function () {
	this.timeout(10_000)

	afterEach(() => {
		for (const repository of temporaryRepositories.splice(0)) {
			rmSync(repository, { recursive: true, force: true })
		}
	})

	it("accepts evidence merged after the previous tag from an older branch", () => {
		const { repository, evidenceCommit, analyzedCommit } = createMergedEvidenceRepository()
		const result = validatePatch(repository, analyzedCommit, evidenceCommit)

		assert.equal(result.status, 0, result.stderr)
	})

	it("rejects evidence already reachable from the previous tag", () => {
		const { repository, previousCommit, analyzedCommit } = createMergedEvidenceRepository()
		const result = validatePatch(repository, analyzedCommit, previousCommit)

		assert.equal(result.status, 1)
		assert.match(result.stderr, /is outside v1\.0\.0\.\./)
	})
})

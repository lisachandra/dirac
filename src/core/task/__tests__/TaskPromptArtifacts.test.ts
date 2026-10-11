import { strict as assert } from "node:assert"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { writePromptMetadataArtifacts } from "../TaskPromptArtifacts"

const ENVIRONMENT_KEYS = ["DIRAC_WRITE_PROMPT_ARTIFACTS", "DIRAC_PROMPT_ARTIFACT_DIR", "IS_DEV"] as const

describe("TaskPromptArtifacts", () => {
	let cwd: string
	let originalEnvironment: Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-prompt-artifacts-"))
		originalEnvironment = {
			DIRAC_WRITE_PROMPT_ARTIFACTS: process.env.DIRAC_WRITE_PROMPT_ARTIFACTS,
			DIRAC_PROMPT_ARTIFACT_DIR: process.env.DIRAC_PROMPT_ARTIFACT_DIR,
			IS_DEV: process.env.IS_DEV,
		}
		for (const key of ENVIRONMENT_KEYS) delete process.env[key]
	})

	afterEach(async () => {
		for (const key of ENVIRONMENT_KEYS) {
			const value = originalEnvironment[key]
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
		await fs.rm(cwd, { recursive: true, force: true })
	})


	it("writes enabled prompt, tool, and full-history request data", async () => {
		const artifactDir = path.join(cwd, "artifacts")
		await writePromptMetadataArtifacts(
			{
				taskId: "task-1",
				cwd,
				writePromptMetadataEnabled: true,
				writePromptMetadataDirectory: "artifacts",
			},
			{
				systemPrompt: "system prompt contents",
				providerInfo: { providerId: "anthropic", modelId: "primary-model" },
				tools: [{ name: "list_files", input_schema: { type: "object" } }],
				fullHistory: [
					{ role: "user", content: "first message" },
					{ role: "assistant", content: [{ type: "text", text: "second message" }] },
				],
				deletedRange: [0, 0],
			},
		)

		const markdown = await fs.readFile(path.join(artifactDir, "task-task-1-debug.md"), "utf8")
		assert.match(markdown, /## System Prompt\n\nsystem prompt contents/)
		assert.match(markdown, /"name": "list_files"/)
		assert.match(markdown, /### \[USER\] \[TRUNCATED\]\nfirst message/)
		assert.match(markdown, /### \[ASSISTANT\]\n\*\*Text:\*\* \nsecond message/)
		assert.equal(await fs.readFile(path.join(artifactDir, ".gitignore"), "utf8"), "*\n!.gitignore\n")
	})

	it("does not create artifacts when output is disabled", async () => {
		await writePromptMetadataArtifacts(
			{
				taskId: "task-disabled",
				cwd,
				writePromptMetadataEnabled: false,
			},
			{
				systemPrompt: "must not be written",
				providerInfo: { providerId: "anthropic", modelId: "primary-model" },
				tools: [],
				fullHistory: [],
			},
		)

		await fs.stat(path.join(cwd, ".dirac-prompt-artifacts")).then(
			() => assert.fail("disabled artifact generation should not create its output directory"),
			(error: NodeJS.ErrnoException) => assert.equal(error.code, "ENOENT"),
		)
	})
})

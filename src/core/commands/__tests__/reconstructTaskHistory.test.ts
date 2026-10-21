import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { reconstructTaskHistoryItem } from "@core/commands/reconstructTaskHistory"
import { ensureTaskDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { DiracMessageType } from "@shared/ExtensionMessage"
import { isTaskHistoryItem } from "@shared/HistoryItem"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

describe("reconstructTaskHistoryItem workspace and legacy recovery", () => {
	let storagePath: string

	beforeEach(async () => {
		storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "reconstruct-workspace-"))
		setVscodeHostProviderMock({ globalStorageFsPath: storagePath })
	})

	afterEach(async () => {
		HostProvider.reset()
		await fs.rm(storagePath, { recursive: true, force: true })
	})

	it("derives workspaceRootPath from tool-context fileHashes keys", async () => {
		const taskId = "1788000000010"
		const taskDirectory = await ensureTaskDirectoryExists(taskId)
		const workspace = path.join("d:", "work", "rocket")
		const cacheKeys = [
			`${path.join(workspace, "AGENTS.md")}#plain`,
			`${path.join(workspace, "src", "main.ts")}#plain`,
			`${path.join(workspace, "src", "util.ts")}#plain`,
			`${path.join("c:", "Users", "someone", "notes.md")}#plain`,
		]
		const updates = Object.fromEntries(cacheKeys.map((key) => [key, { contentHash: "abc" }]))
		await fs.writeFile(
			path.join(taskDirectory, GlobalFileNames.toolContextOperations),
			`${JSON.stringify({ offset: 0, type: "update_entries", key: "fileHashes", updates, deletions: [] })}\n`,
		)
		await saveUserMessage(taskId, "Fix the rocket launcher")

		const item = await reconstructTaskHistoryItem(taskId)

		assert.ok(item)
		assert.equal(item.workspaceRootPath, workspace)
		assert.equal(item.cwdOnTaskInitialization, workspace)
	})

	it("propagates modelId from task metadata", async () => {
		const taskId = "1788000000011"
		const taskDirectory = await ensureTaskDirectoryExists(taskId)
		await fs.writeFile(
			path.join(taskDirectory, GlobalFileNames.taskMetadata),
			JSON.stringify({
				files_in_context: [],
				model_usage: [{ ts: 1, model_id: "th/glm-5.3-flash", model_provider_id: "openai", mode: "act" }],
				environment_history: [],
			}),
		)
		await saveUserMessage(taskId, "Summarize the diff")

		const item = await reconstructTaskHistoryItem(taskId)

		assert.ok(item)
		assert.equal(item.modelId, "th/glm-5.3-flash")
	})

	it("reconstructs a pre-modular legacy transcript with usage and workspace", async () => {
		const taskId = "1788000000012"
		const taskDirectory = await ensureTaskDirectoryExists(taskId)
		const workspace = "d:/work/rocket"
		const legacyMessages = [
			{
				ts: 1788000000012,
				type: "say",
				say: "task",
				text: "<task>\nOld session task\n</task>",
				modelInfo: { providerId: "deepseek", modelId: "deepseek-v4-pro", mode: "act" },
			},
			{
				ts: 1788000000013,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "x", tokensIn: 100, tokensOut: 20, cacheReads: 50, cost: 0.01 }),
			},
			{ ts: 1788000000014, type: "say", say: "text", text: `Read ${workspace}/AGENTS.md today` },
			{ ts: 1788000000015, type: "say", say: "text", text: `Edited ${workspace}/src/main.ts and ${workspace}/src/util.ts` },
		]
		await fs.writeFile(path.join(taskDirectory, GlobalFileNames.uiMessages), JSON.stringify(legacyMessages))

		const item = await reconstructTaskHistoryItem(taskId)

		assert.ok(item)
		assert.ok(isTaskHistoryItem(item))
		assert.equal(item.task, "Old session task")
		assert.equal(item.tokensIn, 100)
		assert.equal(item.tokensOut, 20)
		assert.equal(item.cacheReads, 50)
		assert.equal(item.totalCost, 0.01)
		assert.equal(item.modelId, "deepseek-v4-pro")
		assert.equal(item.workspaceRootPath, path.normalize(workspace))
	})

	it("skips tasks whose transcripts are entirely unreadable", async () => {
		const taskId = "1788000000013"
		const taskDirectory = await ensureTaskDirectoryExists(taskId)
		await fs.writeFile(path.join(taskDirectory, GlobalFileNames.uiMessages), JSON.stringify([{ ts: 1, type: "say", say: "text" }]))

		const item = await reconstructTaskHistoryItem(taskId)

		assert.equal(item, null)
	})
})

async function saveUserMessage(taskId: string, content: string): Promise<void> {
	const taskDirectory = await ensureTaskDirectoryExists(taskId)
	await fs.writeFile(
		path.join(taskDirectory, GlobalFileNames.uiMessagesBaseline),
		`${JSON.stringify({ type: "baseline", offset: 0 })}\n${JSON.stringify({
			type: "message",
			message: {
				id: `${taskId}-1`,
				ts: Number(taskId.slice(0, 13)),
				content: { type: DiracMessageType.MARKDOWN, role: "user", content },
			},
		})}\n`,
	)
}

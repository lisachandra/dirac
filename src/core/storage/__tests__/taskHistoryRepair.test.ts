import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { GoalStore } from "@core/goal/GoalStore"
import type { StateManager } from "@core/storage/StateManager"
import { ensureTaskDirectoryExists, saveDiracMessages } from "@core/storage/disk"
import { repairMissingTaskHistory } from "@core/commands/repairMissingTaskHistory"
import { withTaskHistoryInventoryLock } from "@core/storage/taskHistory"
import { DiracMessageType } from "@shared/ExtensionMessage"
import type { RunHistoryItem } from "@shared/HistoryItem"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

describe("task-history startup repair", () => {
	let storagePath: string

	beforeEach(async () => {
		storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-repair-"))
		setVscodeHostProviderMock({ globalStorageFsPath: storagePath })
	})

	afterEach(async () => {
		HostProvider.reset()
		await fs.rm(storagePath, { recursive: true, force: true })
	})

	it("adds recoverable Tasks and Goals without replacing existing history or exposing private ULIDs", async () => {
		const existing = historyItem("1788000000001", "Existing summary")
		const orphanTaskId = "1788000000002"
		const goalId = "1788000000003"
		const privateRunId = "01M0WECW219NTNX8KGK7X43BE2"
		await saveMessages(orphanTaskId, "Recovered Task")
		await saveMessages(privateRunId, "Private Goal child")
		await new GoalStore().create(goalId, "01M0WEC6XTSG2ZX1951ZZC1J7V", "Recovered Goal")
		await saveMessages(goalId, "Recovered Goal")

		let history: RunHistoryItem[] = [existing]
		const stateManager = {
			getGlobalStateKey: () => history,
			insertMissingTaskHistoryItems: (items: RunHistoryItem[]) => {
				const existingIds = new Set(history.map((item) => item.id))
				history = [...history, ...items.filter((item) => !existingIds.has(item.id))]
				return history
			},
			flushPendingState: async () => {},
		} as unknown as StateManager

		const result = await repairMissingTaskHistory(stateManager)

		assert.equal(result.status, "completed")
		assert.equal(result.recovered, 2)
		assert.equal(history.find((item) => item.id === existing.id), existing)
		assert.equal(history.some((item) => item.id === orphanTaskId), true)
		assert.equal(history.some((item) => item.id === goalId && item.runKind === "goal"), true)
		assert.equal(history.some((item) => item.id === privateRunId), false)

		const secondResult = await repairMissingTaskHistory(stateManager)
		assert.equal(secondResult.recovered, 0)
	})

	it("skips scanning when another instance owns the inventory lease", async () => {
		const stateManager = {
			getGlobalStateKey: () => [],
		} as unknown as StateManager

		await withTaskHistoryInventoryLock(async () => {
			const result = await repairMissingTaskHistory(stateManager)
			assert.equal(result.status, "skipped")
		})
	})
})

async function saveMessages(taskId: string, content: string): Promise<void> {
	await ensureTaskDirectoryExists(taskId)
	await saveDiracMessages(taskId, [
		{
			id: `${taskId}-message`,
			ts: Number(taskId.slice(0, 13)) || Date.now(),
			content: { type: DiracMessageType.MARKDOWN, role: "user", content },
		},
	])
}

function historyItem(id: string, task: string): RunHistoryItem {
	return { id, ts: Number(id), task, tokensIn: 1, tokensOut: 1, totalCost: 0, isFavorited: true }
}

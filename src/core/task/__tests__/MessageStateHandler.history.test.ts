import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { HostProvider } from "@/hosts/host-provider"
import { DiracMessageType } from "@shared/ExtensionMessage"
import { TaskState } from "../TaskState"
import { MessageStateHandler } from "../message-state"

describe("MessageStateHandler task history", () => {
	let storageDirectory: string

	beforeEach(async () => {
		storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-message-history-"))
		setVscodeHostProviderMock({ globalStorageFsPath: storageDirectory })
	})

	afterEach(async () => {
		HostProvider.reset()
		await fs.rm(storageDirectory, { recursive: true, force: true })
	})

	it("measures the complete task directory at the history boundary", async () => {
		let historyItem: { size?: number } | undefined
		const handler = new MessageStateHandler({
			taskId: "task-1",
			ulid: "conversation-1",
			taskState: new TaskState(),
			updateTaskHistory: async (item) => {
				historyItem = item
				return [item]
			},
		})
		await handler.addToDiracMessages({
			id: "task",
			ts: 1,
			content: { type: DiracMessageType.MARKDOWN, content: "task", role: "user" },
		})
		const taskDirectory = path.join(storageDirectory, "tasks", "task-1")
		await fs.mkdir(taskDirectory, { recursive: true })
		await fs.writeFile(path.join(taskDirectory, "non-log-artifact.bin"), Buffer.alloc(4_096))

		await handler.flushTaskHistory()

		assert.ok((historyItem?.size ?? 0) >= 4_096)
	})
})

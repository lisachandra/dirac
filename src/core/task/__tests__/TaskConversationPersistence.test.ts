import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { TaskConversationPersistence } from "../TaskConversationPersistence"

describe("TaskConversationPersistence", () => {
	it("acknowledges only after the coordinator conversation flush succeeds", async () => {
		const calls: string[] = []
		const persistence = new TaskConversationPersistence({
			onUserContentPersisted: async () => {
				calls.push("acknowledge")
			},
			onUserContentPersistenceFailed: async () => {
				calls.push("rollback")
			},
		})

		await persistence.persist(async () => {
			calls.push("flush")
		})
		await persistence.rollback()

		assert.deepEqual(calls, ["flush", "acknowledge"])
	})

	it("rolls back an unread claim when the coordinator conversation flush fails", async () => {
		const calls: string[] = []
		const persistence = new TaskConversationPersistence({
			onUserContentPersisted: async () => {
				calls.push("acknowledge")
			},
			onUserContentPersistenceFailed: async () => {
				calls.push("rollback")
			},
		})

		await assert.rejects(
			persistence.persist(async () => {
				calls.push("flush")
				throw new Error("disk full")
			}),
			/disk full/,
		)
		await persistence.rollback()

		assert.deepEqual(calls, ["flush", "rollback"])
	})

	it("does not roll back durable history when owner settlement fails", async () => {
		const calls: string[] = []
		const persistence = new TaskConversationPersistence({
			onUserContentPersisted: async () => {
				calls.push("acknowledge")
				throw new Error("settlement failed")
			},
			onUserContentPersistenceFailed: async () => {
				calls.push("rollback")
			},
		})

		await assert.rejects(
			persistence.persist(async () => {
				calls.push("flush")
			}),
			/settlement failed/,
		)
		await persistence.rollback()

		assert.deepEqual(calls, ["flush", "acknowledge"])
	})
})

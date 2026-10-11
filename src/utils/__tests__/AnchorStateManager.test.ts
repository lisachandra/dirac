import { strict as assert } from "node:assert"
import { afterEach, describe, it } from "mocha"
import { MAX_ANCHORED_FILE_LINES } from "@shared/anchor-limits"
import { AnchorStateManager } from "../AnchorStateManager"

describe("AnchorStateManager persistence", () => {
	const taskId = "anchor-state-persistence"
	const absolutePath = "/workspace/example.ts"

	afterEach(() => {
		AnchorStateManager.reset(taskId)
	})

	it("round-trips the exact anchors and document fingerprint", () => {
		const lines = ["first", "second", "third"]
		const anchors = [...AnchorStateManager.reconcile(absolutePath, lines, taskId)]
		const fingerprint = AnchorStateManager.getDocumentFingerprint(absolutePath, taskId)
		const persisted = AnchorStateManager.exportState(taskId)

		AnchorStateManager.reset(taskId)
		AnchorStateManager.hydrate(taskId, persisted)

		assert.deepEqual(AnchorStateManager.getAnchors(absolutePath, taskId), anchors)
		assert.equal(AnchorStateManager.getDocumentFingerprint(absolutePath, taskId), fingerprint)
		assert.deepEqual(AnchorStateManager.reconcile(absolutePath, lines, taskId), anchors)
	})

	it("restores enough allocation state for deterministic future reconciliation", () => {
		const originalLines = ["first", "second"]
		AnchorStateManager.reconcile(absolutePath, originalLines, taskId)
		const persisted = AnchorStateManager.exportState(taskId)
		persisted.documents[0].availablePool = []
		const changedLines = ["first", "inserted", "second"]

		AnchorStateManager.reset(taskId)
		AnchorStateManager.hydrate(taskId, persisted)
		const firstReconciliation = [...AnchorStateManager.reconcile(absolutePath, changedLines, taskId)]

		AnchorStateManager.reset(taskId)
		AnchorStateManager.hydrate(taskId, persisted)
		const secondReconciliation = [...AnchorStateManager.reconcile(absolutePath, changedLines, taskId)]

		assert.deepEqual(secondReconciliation, firstReconciliation)
	})

	it("rejects duplicate or structurally inconsistent persisted IDs", () => {
		assert.throws(
			() => AnchorStateManager.hydrate(taskId, {
				version: 1,
				documents: [{
					absolutePath,
					hashes: [1, 2],
					anchors: ["Apple", "Apple"],
					usedWords: ["Apple"],
					availablePool: [],
				}],
			}),
			/duplicate or invalid visible IDs/,
		)

		assert.throws(
			() => AnchorStateManager.hydrate(taskId, {
				version: 1,
				documents: [{
					absolutePath,
					hashes: [1],
					anchors: [],
					usedWords: [],
					availablePool: [],
				}],
			}),
			/mismatched hashes and anchors/,
		)
	})

	it("allows the same visible ID in different file scopes", () => {
		const otherPath = "/workspace/other.ts"
		AnchorStateManager.hydrate(taskId, {
			version: 1,
			documents: [absolutePath, otherPath].map((documentPath) => ({
				absolutePath: documentPath,
				hashes: [1],
				anchors: ["Apple"],
				usedWords: ["Apple"],
				availablePool: [],
			})),
		})

		assert.deepEqual(AnchorStateManager.getAnchors(absolutePath, taskId), ["Apple"])
		assert.deepEqual(AnchorStateManager.getAnchors(otherPath, taskId), ["Apple"])
	})

	it("rejects files above the hash-anchoring line limit without tracking them", () => {
		const lines = Array.from({ length: MAX_ANCHORED_FILE_LINES + 1 }, (_, index) => `line ${index}`)

		assert.throws(
			() => AnchorStateManager.reconcile(absolutePath, lines, taskId),
			/hash anchors.*limit/i,
		)
		assert.equal(AnchorStateManager.isTracking(absolutePath, taskId), false)
	})

})

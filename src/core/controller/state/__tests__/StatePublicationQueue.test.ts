import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { StatePublicationQueue } from "../StatePublicationQueue"

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

describe("StatePublicationQueue", () => {
	it("coalesces publication requests made before state assembly starts", async () => {
		let readCount = 0
		const sequences: number[] = []
		const queue = new StatePublicationQueue(
			async () => ++readCount,
			async (_state, sequenceNumber) => {
				sequences.push(sequenceNumber)
			},
		)

		const first = queue.requestPublication()
		const second = queue.requestPublication()
		await Promise.all([first, second])

		assert.equal(readCount, 1)
		assert.deepEqual(sequences, [1])
	})

	it("resolves each request after the publication that covers it", async () => {
		const firstDelivery = deferred()
		const firstDeliveryStarted = deferred()
		const secondDelivery = deferred()
		let currentState = "first"
		let activeDeliveries = 0
		let maxActiveDeliveries = 0
		const publications: Array<{ state: string; sequenceNumber: number }> = []
		const queue = new StatePublicationQueue(
			async () => currentState,
			async (state, sequenceNumber) => {
				activeDeliveries++
				maxActiveDeliveries = Math.max(maxActiveDeliveries, activeDeliveries)
				publications.push({ state, sequenceNumber })
				if (sequenceNumber === 1) {
					firstDeliveryStarted.resolve()
					await firstDelivery.promise
				} else {
					await secondDelivery.promise
				}
				activeDeliveries--
			},
		)

		const first = queue.requestPublication()
		await firstDeliveryStarted.promise
		currentState = "second"
		const second = queue.requestPublication()
		firstDelivery.resolve()

		const firstOutcome = await Promise.race([
			first.then(() => "resolved" as const),
			new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 20)),
		])
		secondDelivery.resolve()
		await second

		assert.equal(firstOutcome, "resolved")
		assert.equal(maxActiveDeliveries, 1)
		assert.deepEqual(publications, [
			{ state: "first", sequenceNumber: 1 },
			{ state: "second", sequenceNumber: 2 },
		])
	})

	it("discards a state snapshot superseded during asynchronous assembly", async () => {
		const firstReadStarted = deferred()
		const finishFirstRead = deferred()
		let currentState = "old"
		let readCount = 0
		const publications: string[] = []
		const queue = new StatePublicationQueue(
			async () => {
				const capturedState = currentState
				readCount++
				if (readCount === 1) {
					firstReadStarted.resolve()
					await finishFirstRead.promise
				}
				return capturedState
			},
			async (state) => {
				publications.push(state)
			},
		)

		const first = queue.requestPublication()
		await firstReadStarted.promise
		currentState = "new"
		const second = queue.requestPublication()
		finishFirstRead.resolve()
		await Promise.all([first, second])

		assert.equal(readCount, 2)
		assert.deepEqual(publications, ["new"])
	})

	it("merges a presentation request into a superseding control snapshot", async () => {
		const controlReadStarted = deferred()
		const finishControlRead = deferred()
		const reads: string[] = []
		const publications: string[] = []
		const queue = new StatePublicationQueue<string, "control" | "presentation">(
			async (request) => {
				reads.push(request)
				if (reads.length === 1) {
					controlReadStarted.resolve()
					await finishControlRead.promise
				}
				return request
			},
			async (state) => {
				publications.push(state)
			},
			(pending, requested) => (pending === "control" || requested === "control" ? "control" : "presentation"),
		)

		const control = queue.requestPublication("control")
		await controlReadStarted.promise
		const presentation = queue.requestPublication("presentation")
		finishControlRead.resolve()
		await Promise.all([control, presentation])

		assert.deepEqual(reads, ["control", "control"])
		assert.deepEqual(publications, ["control"])
	})
})

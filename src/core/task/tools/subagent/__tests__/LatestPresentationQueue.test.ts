import { strict as assert } from "node:assert";
import { describe, it } from "mocha";
import { LatestPresentationQueue } from "../LatestPresentationQueue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

describe("LatestPresentationQueue", () => {
	it("keeps one in-flight presentation and replaces queued snapshots with the latest", async () => {
		const firstPresentation = deferred()
		const presented: string[] = []
		const queue = new LatestPresentationQueue(() => { })

		queue.enqueue(async () => {
			presented.push("first")
			await firstPresentation.promise
		})
		queue.enqueue(async () => {
			presented.push("superseded")
		})
		queue.enqueue(async () => {
			presented.push("latest")
		})

		firstPresentation.resolve()
		await queue.waitForInFlightPresentation()

		assert.deepEqual(presented, ["first", "latest"])
	})

	it("drops queued snapshots when terminal reconciliation starts", async () => {
		const firstPresentation = deferred()
		const presented: string[] = []
		const queue = new LatestPresentationQueue(() => { })

		queue.enqueue(async () => {
			presented.push("first")
			await firstPresentation.promise
		})
		queue.enqueue(async () => {
			presented.push("queued")
		})
		queue.stopAcceptingUpdates()
		firstPresentation.resolve()
		await queue.waitForInFlightPresentation()

		assert.deepEqual(presented, ["first"])
	})
})

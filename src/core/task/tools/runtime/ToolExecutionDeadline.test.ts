import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { ToolExecutionDeadline, ToolTimeoutError } from "./ToolExecutionDeadline"

describe("ToolExecutionDeadline", () => {
	it("starts its budget with the first execution operation", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const deadline = new ToolExecutionDeadline("list_files", { timeoutMs: 30_000 })
			await clock.tickAsync(15_000)

			let operationSignal: AbortSignal | undefined
			const pending = deadline.run("listing files", async (signal) => {
				operationSignal = signal
				return await new Promise<string>(() => {})
			})
			const rejection = assert.rejects(pending, ToolTimeoutError)
			await clock.tickAsync(29_999)
			assert.equal(operationSignal?.aborted, false)

			await clock.tickAsync(1)
			await rejection
		} finally {
			clock.restore()
		}
	})

	it("shares one wall-clock budget across sequential operations", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const deadline = new ToolExecutionDeadline("read_file", { timeoutMs: 30_000 })
			await deadline.run("first read", async () => "first")
			await clock.tickAsync(10_000)

			const pending = deadline.run("second read", async () => await new Promise<string>(() => {}))
			const rejection = assert.rejects(pending, (error: unknown) => {
				assert.ok(error instanceof ToolTimeoutError)
				assert.equal(error.toolName, "read_file")
				assert.equal(error.operation, "second read")
				assert.equal(error.timeoutMs, 30_000)
				return true
			})
			await clock.tickAsync(20_000)

			await rejection
		} finally {
			clock.restore()
		}
	})

	it("aborts the running operation when the deadline expires", async () => {
		const clock = sinon.useFakeTimers()
		try {
			const deadline = new ToolExecutionDeadline("search_files", { timeoutMs: 30_000 })
			let operationSignal: AbortSignal | undefined
			const pending = deadline.run("searching src", async (signal) => {
				operationSignal = signal
				return await new Promise<string>(() => {})
			})
			const rejection = assert.rejects(pending, ToolTimeoutError)

			await clock.tickAsync(30_000)
			await rejection
			assert.equal(operationSignal?.aborted, true)
			assert.ok(operationSignal?.reason instanceof ToolTimeoutError)
		} finally {
			clock.restore()
		}
	})

	it("forwards task cancellation to the running operation", async () => {
		const controller = new AbortController()
		const deadline = new ToolExecutionDeadline("search_files", { cancellationSignal: controller.signal })
		let operationSignal: AbortSignal | undefined
		const pending = deadline.run("searching src", async (signal) => {
			operationSignal = signal
			return await new Promise<string>(() => {})
		})
		const reason = new Error("task stopped")
		const rejection = assert.rejects(pending, (error: unknown) => error === reason)

		controller.abort(reason)

		await rejection
		assert.equal(operationSignal?.aborted, true)
	})
})

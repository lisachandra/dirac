import pTimeout from "p-timeout"

export const DEFAULT_BOUNDED_TOOL_EXECUTION_MS = 30_000

export class ToolTimeoutError extends Error {
	readonly outcome = "timeout"

	constructor(
		readonly toolName: string,
		readonly operation: string,
		readonly timeoutMs: number,
	) {
		super(`Tool '${toolName}' timed out after ${timeoutMs / 1_000} seconds while ${operation}.`)
		this.name = "ToolTimeoutError"
	}
}

interface ToolExecutionDeadlineOptions {
	timeoutMs?: number
	cancellationSignal?: AbortSignal
	clock?: () => number
}

/** Applies one shared wall-clock budget across a tool's awaited execution operations. */
export class ToolExecutionDeadline {
	private expiresAt: number | undefined
	private readonly timeoutMs: number
	private readonly cancellationSignal?: AbortSignal
	private readonly clock: () => number

	constructor(
		private readonly toolName: string,
		options: ToolExecutionDeadlineOptions = {},
	) {
		this.timeoutMs = options.timeoutMs ?? DEFAULT_BOUNDED_TOOL_EXECUTION_MS
		this.cancellationSignal = options.cancellationSignal
		this.clock = options.clock ?? Date.now
	}

	async run<T>(operationName: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const timeoutError = new ToolTimeoutError(this.toolName, operationName, this.timeoutMs)
		this.expiresAt ??= this.clock() + this.timeoutMs
		const remainingMs = this.expiresAt - this.clock()
		if (remainingMs <= 0) throw timeoutError

		const abortController = new AbortController()
		const cancelOperation = () => abortController.abort(this.cancellationSignal?.reason)
		if (this.cancellationSignal?.aborted) {
			cancelOperation()
			throw this.cancellationSignal.reason instanceof Error
				? this.cancellationSignal.reason
				: new Error("Tool execution cancelled")
		}
		this.cancellationSignal?.addEventListener("abort", cancelOperation, { once: true })
		try {
			return await pTimeout(operation(abortController.signal), {
				milliseconds: remainingMs,
				message: timeoutError,
				signal: this.cancellationSignal,
			})
		} catch (error) {
			if (error === timeoutError) abortController.abort(timeoutError)
			throw error
		} finally {
			this.cancellationSignal?.removeEventListener("abort", cancelOperation)
		}
	}
}

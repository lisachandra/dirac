export type StatePublisher<TState> = (state: TState, sequenceNumber: number) => Promise<void>

interface PublicationCompletion {
	promise: Promise<void>
	resolve: () => void
	reject: (error: unknown) => void
}

export class StatePublicationQueue<TState, TRequest = undefined> {
	private requestedGeneration = 0
	private publishedGeneration = 0
	private isDraining = false
	private pendingCompletion?: PublicationCompletion
	private activeCompletion?: PublicationCompletion
	private pendingRequest?: TRequest
	private sequenceNumber = 0

	constructor(
		private readonly readState: (request: TRequest) => Promise<TState>,
		private readonly publishState: StatePublisher<TState>,
		private readonly mergeRequests: (pending: TRequest, requested: TRequest) => TRequest = (_pending, requested) => requested,
	) {}

	requestPublication(...args: TRequest extends undefined ? [] : [request: TRequest]): Promise<void> {
		const request = args[0] as TRequest
		this.requestedGeneration++
		this.pendingRequest = this.pendingRequest === undefined ? request : this.mergeRequests(this.pendingRequest, request)
		this.pendingCompletion ??= createPublicationCompletion()
		if (!this.isDraining) {
			this.isDraining = true
			void this.drainPublications()
		}
		return this.pendingCompletion.promise
	}

	private async drainPublications(): Promise<void> {
		await Promise.resolve()
		try {
			while (this.publishedGeneration < this.requestedGeneration) {
				const targetGeneration = this.requestedGeneration
				const request = this.pendingRequest as TRequest
				const state = await this.readState(request)
				// State assembly is asynchronous. Merge a superseding request into a new
				// snapshot rather than publishing control or presentation state out of order.
				if (targetGeneration !== this.requestedGeneration) continue
				this.activeCompletion = this.pendingCompletion
				this.pendingCompletion = undefined
				this.pendingRequest = undefined
				await this.publishState(state, ++this.sequenceNumber)
				this.publishedGeneration = targetGeneration
				this.activeCompletion?.resolve()
				this.activeCompletion = undefined
			}
		} catch (error) {
			this.activeCompletion?.reject(error)
			this.pendingCompletion?.reject(error)
			this.activeCompletion = undefined
			this.pendingCompletion = undefined
			this.pendingRequest = undefined
		} finally {
			this.isDraining = false
		}
	}
}

function createPublicationCompletion(): PublicationCompletion {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

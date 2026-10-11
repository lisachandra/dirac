export class LatestPresentationQueue {
	private acceptingUpdates = true
	private pendingPresentation: (() => Promise<void>) | undefined
	private presentationDrain = Promise.resolve()
	private isDraining = false

	constructor(private readonly reportFailure: (error: unknown) => void) {}

	enqueue(present: () => Promise<void>): void {
		if (!this.acceptingUpdates) return
		this.pendingPresentation = present
		if (this.isDraining) return

		this.isDraining = true
		this.presentationDrain = this.drainLatestPresentation()
	}

	stopAcceptingUpdates(): void {
		this.acceptingUpdates = false
		this.pendingPresentation = undefined
	}

	waitForInFlightPresentation(): Promise<void> {
		return this.presentationDrain
	}

	private async drainLatestPresentation(): Promise<void> {
		while (this.acceptingUpdates && this.pendingPresentation) {
			const present = this.pendingPresentation
			this.pendingPresentation = undefined
			try {
				await present()
			} catch (error) {
				this.reportFailure(error)
			}
		}
		this.isDraining = false
	}
}

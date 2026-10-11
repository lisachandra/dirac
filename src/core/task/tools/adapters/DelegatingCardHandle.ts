import type { CardStatus } from "@shared/ExtensionMessage"
import type { ICardHandle } from "../interfaces/IToolEnvironment"

/** Explicit card decorator that keeps lifecycle state owned by the wrapped handle. */
export class DelegatingCardHandle implements ICardHandle {
	constructor(protected readonly card: ICardHandle) {}

	get collapsed() { return this.card.collapsed }
	get id() { return this.card.id }
	get header() { return this.card.header }
	get icon() { return this.card.icon }
	get renderType() { return this.card.renderType }
	get body() { return this.card.body }
	get rawInput() { return this.card.rawInput }
	get rawOutput() { return this.card.rawOutput }
	get locations() { return this.card.locations }
	get requireApproval() { return this.card.requireApproval }
	get requireFeedback() { return this.card.requireFeedback }
	get feedbackPlaceholder() { return this.card.feedbackPlaceholder }
	get actions() { return this.card.actions }
	get maxHeight() { return this.card.maxHeight }
	get cleanupStrategy() { return this.card.cleanupStrategy }
	get status() { return this.card.status }
	get requiresUserInteraction() { return this.card.requiresUserInteraction }

	update(patch: Parameters<ICardHandle["update"]>[0]): Promise<void> {
		return this.card.update(patch)
	}

	waitForInteraction(): ReturnType<ICardHandle["waitForInteraction"]> {
		return this.card.waitForInteraction()
	}

	appendBody(chunk: string): Promise<void> {
		return this.card.appendBody(chunk)
	}

	finalize(status: CardStatus, doNotAutoCollapse?: boolean): Promise<void> {
		return this.card.finalize(status, doNotAutoCollapse)
	}
}

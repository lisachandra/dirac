export interface TaskConversationPersistenceHooks {
	onUserContentPersisted(): Promise<void>
	onUserContentPersistenceFailed(): Promise<void>
}

type PersistenceState = "pending" | "persisted" | "rolled_back"

/** Coordinates a Task user-message flush with an owner-defined durable acknowledgement. */
export class TaskConversationPersistence {
	private state: PersistenceState

	constructor(private readonly hooks?: TaskConversationPersistenceHooks) {
		this.state = hooks ? "pending" : "persisted"
	}

	async persist(flush: () => Promise<void>): Promise<void> {
		if (!this.hooks) return
		await flush()
		this.state = "persisted"
		await this.hooks.onUserContentPersisted()
	}

	async rollback(): Promise<void> {
		if (this.state !== "pending") return
		this.state = "rolled_back"
		await this.hooks?.onUserContentPersistenceFailed()
	}
}

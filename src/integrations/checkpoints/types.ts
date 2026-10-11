/**
 * Common interface for checkpoint managers
 * Allows single-root and multi-root managers to be used interchangeably
 */
export interface ICheckpointManager {
	/** Non-throwing commit-tail update that aligns capability with the committed task configuration. */
	setEnabled(enabled: boolean): void
	isEnabled(): boolean

	saveCheckpoint(isAttemptCompletionMessage?: boolean, completionMessageId?: string): Promise<void>

	restoreCheckpoint(messageId: string, restoreType: any, offset?: number): Promise<any>

	doesLatestTaskCompletionHaveNewChanges(): Promise<boolean>

	commit(): Promise<string | undefined>

	presentMultifileDiff?(messageId: string, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void>

	// Optional method for multi-root specific initialization
	initialize?(): Promise<void>

	// Optional method for checking and initializing checkpoint tracker
	checkpointTrackerCheckAndInit?(): Promise<any>
}

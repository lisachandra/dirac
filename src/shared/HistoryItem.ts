import type { GoalAccounting, GoalStatus } from "./goal"

export interface RunHistoryItemBase {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	/**
	 * Legacy display text consumed by existing history surfaces. Goal entries keep
	 * their immutable initial display text here and expose the current objective
	 * separately through `objectivePreview`.
	 */
	task: string

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	workspaceRootPath?: string
	checkpointManagerErrorMessage?: string

	modelId?: string
}

/**
 * Existing records have no discriminator. Absence therefore continues to mean
 * an ordinary Task, while newly written Task records may opt into `"task"`.
 */
export interface TaskHistoryItem extends RunHistoryItemBase {
	runKind?: "task"
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
}

/** Compact top-level Goal summary. Full mutable Goal state stays in goal.json. */
export interface GoalHistoryItem extends RunHistoryItemBase {
	runKind: "goal"
	conversationUlid: string
	initialDisplayText: string
	objectivePreview: string
	objectiveRevision: number
	status: GoalStatus
	statusReason?: string
	createdAt: number
	updatedAt: number
	activeDurationMs: number
	accounting: GoalAccounting
}

export type RunHistoryItem = TaskHistoryItem | GoalHistoryItem

/**
 * Backward-compatible name used throughout existing Task and history surfaces.
 * New code should use the discriminated names above.
 */
export type HistoryItem = RunHistoryItem

export function isGoalHistoryItem(item: RunHistoryItem): item is GoalHistoryItem {
	return item.runKind === "goal"
}

export function isTaskHistoryItem(item: RunHistoryItem): item is TaskHistoryItem {
	return item.runKind !== "goal"
}

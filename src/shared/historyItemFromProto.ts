import type { GoalAccounting, GoalStatus } from "./goal"
import type { GoalHistoryItem, HistoryItem, RunHistoryItemBase, TaskHistoryItem } from "./HistoryItem"
import type { GoalAccountingItem, TaskItem } from "./proto/dirac/task"

const GOAL_STATUSES = new Set<GoalStatus>(["working", "waiting", "paused", "blocked", "achieved", "stopped"])

/** Restores the discriminated history shape transported by the legacy Task history RPC. */
export function historyItemFromProto(item: TaskItem): HistoryItem {
	const base = historyBaseFromProto(item)
	if (item.runKind !== "goal") {
		return {
			...base,
			...(item.runKind === "task" ? { runKind: "task" as const } : {}),
			tokensIn: item.tokensIn ?? 0,
			tokensOut: item.tokensOut ?? 0,
			...(item.cacheWrites !== undefined ? { cacheWrites: item.cacheWrites } : {}),
			...(item.cacheReads !== undefined ? { cacheReads: item.cacheReads } : {}),
			totalCost: item.totalCost ?? 0,
		} satisfies TaskHistoryItem
	}

	const status = requiredGoalStatus(item.status, item.id)
	return {
		...base,
		runKind: "goal",
		conversationUlid: requiredString(item.conversationUlid, "conversationUlid", item.id),
		initialDisplayText: requiredString(item.initialDisplayText, "initialDisplayText", item.id),
		objectivePreview: requiredString(item.objectivePreview, "objectivePreview", item.id),
		objectiveRevision: requiredNonnegativeNumber(item.objectiveRevision, "objectiveRevision", item.id, true),
		status,
		...(item.statusReason ? { statusReason: item.statusReason } : {}),
		createdAt: requiredNonnegativeNumber(item.createdAt, "createdAt", item.id),
		updatedAt: requiredNonnegativeNumber(item.updatedAt, "updatedAt", item.id),
		activeDurationMs: requiredNonnegativeNumber(item.activeDurationMs, "activeDurationMs", item.id),
		accounting: accountingFromProto(item.accounting),
	} satisfies GoalHistoryItem
}

function historyBaseFromProto(item: TaskItem): RunHistoryItemBase {
	return {
		id: item.id,
		ts: item.ts,
		task: item.task,
		size: item.size,
		isFavorited: item.isFavorited,
		...(item.modelId ? { modelId: item.modelId } : {}),
	}
}

function accountingFromProto(accounting: GoalAccountingItem | undefined): GoalAccounting {
	if (!accounting) return {}
	return {
		...optionalMetric("totalTokens", accounting.totalTokens),
		...optionalMetric("inputTokens", accounting.inputTokens),
		...optionalMetric("outputTokens", accounting.outputTokens),
		...optionalMetric("reasoningTokens", accounting.reasoningTokens),
		...optionalMetric("cacheReadTokens", accounting.cacheReadTokens),
		...optionalMetric("cacheWriteTokens", accounting.cacheWriteTokens),
		...optionalMetric("cost", accounting.cost),
	}
}

function optionalMetric<Key extends keyof GoalAccounting>(key: Key, value: number | undefined): Pick<GoalAccounting, Key> | {} {
	if (value === undefined) return {}
	if (!Number.isFinite(value) || value < 0) throw new Error(`Goal accounting field ${key} is invalid`)
	return { [key]: value } as Pick<GoalAccounting, Key>
}

function requiredString(value: string | undefined, field: string, goalId: string): string {
	if (!value) throw new Error(`Goal ${goalId} history is missing ${field}`)
	return value
}

function requiredNonnegativeNumber(value: number | undefined, field: string, goalId: string, positiveInteger = false): number {
	if (!Number.isFinite(value) || value === undefined || value < 0) {
		throw new Error(`Goal ${goalId} history has invalid ${field}`)
	}
	if (positiveInteger && (!Number.isInteger(value) || value < 1)) {
		throw new Error(`Goal ${goalId} history has invalid ${field}`)
	}
	return value
}

function requiredGoalStatus(value: string | undefined, goalId: string): GoalStatus {
	if (!value || !GOAL_STATUSES.has(value as GoalStatus)) {
		throw new Error(`Goal ${goalId} history has invalid status`)
	}
	return value as GoalStatus
}

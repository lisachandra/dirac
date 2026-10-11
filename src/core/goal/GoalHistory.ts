import type { GoalRecord } from "@shared/goal"
import type { GoalHistoryItem } from "@shared/HistoryItem"
import { goalActiveDurationAt } from "./GoalLifecycle"

export function createGoalHistoryItem(
	record: GoalRecord,
	initialDisplayText: string,
	workspaceRootPath?: string,
): GoalHistoryItem {
	return {
		runKind: "goal",
		id: record.id,
		ulid: record.conversationUlid,
		conversationUlid: record.conversationUlid,
		ts: record.updatedAt,
		task: initialDisplayText,
		initialDisplayText,
		objectivePreview: objectivePreview(record.objective.markdown),
		objectiveRevision: record.objective.revision,
		status: record.status,
		...(record.statusReason ? { statusReason: record.statusReason } : {}),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		activeDurationMs: goalActiveDurationAt(record, Date.now()),
		accounting: record.accounting,
		workspaceRootPath,
	}
}

function objectivePreview(markdown: string): string {
	const compact = markdown.replace(/\s+/g, " ").trim()
	return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`
}

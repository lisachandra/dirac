import type { HistoryItem } from "@shared/HistoryItem"
import { historyItemBelongsToWorkspace } from "../historyItemWorkspace"

/** Filters/sorts/caps task history for the active workspace root. */
export function processTaskHistory(taskHistory: HistoryItem[], primaryRootPath: string | undefined): HistoryItem[] {
	return taskHistory
		.filter((item) => !!item.ts && !!item.task && historyItemBelongsToWorkspace(item, primaryRootPath))
		.sort((a, b) => b.ts - a.ts)
		.slice(0, 100)
}

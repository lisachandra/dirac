import type { HistoryItem } from "@shared/HistoryItem"
import { arePathsEqual } from "@utils/path"

/** Returns whether a history item is attributable to the active workspace root. */
export function historyItemBelongsToWorkspace(item: HistoryItem, workspaceRootPath: string | undefined): boolean {
	if (!workspaceRootPath) return false
	const itemWorkspacePath = item.workspaceRootPath || item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
	return !!itemWorkspacePath && arePathsEqual(itemWorkspacePath, workspaceRootPath)
}

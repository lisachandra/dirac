import { exit } from "node:process"
import type { HistoryItem } from "@/shared/HistoryItem"
import { initializeCli } from "../init"
import { disposeCliContext } from "../utils/cleanup"
import { runInkApp } from "../utils/ink"

/**
 * Validate that a task exists in history
 * @returns The task history item if found, null otherwise
 */
export async function findTaskInHistory(taskId: string): Promise<HistoryItem | null> {
	const { StateManager } = await import("@/core/storage/StateManager")
	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	return (taskHistory as HistoryItem[]).find((item) => item.id === taskId) || null
}

/**
 * List task history
 */
export async function listHistory(options: { config?: string; limit?: number; page?: number }) {
	const { StateManager } = await import("@/core/storage/StateManager")
	const { telemetryService } = await import("@/services/telemetry")
	const { printInfo } = await import("../utils/display")
	const { checkRawModeSupport } = await import("../context/StdinContext")

	const ctx = await initializeCli(options)
	const React = (await import("react")).default
	const { App } = await import("../components/App")

	const taskHistory = StateManager.get().getGlobalStateKey("taskHistory") || []
	// Sort by timestamp (newest first) before pagination
	const sortedHistory = [...taskHistory].sort((a: HistoryItem, b: HistoryItem) => (b.ts || 0) - (a.ts || 0))
	const limit = options.limit || 10
	const requestedPage = options.page || 1
	const totalCount = sortedHistory.length
	const totalPages = Math.ceil(totalCount / limit)
	const initialPage = Math.min(requestedPage, Math.max(1, totalPages))

	telemetryService.captureHostEvent("history_command", "executed")

	if (sortedHistory.length === 0) {
		printInfo("No task history found.")
		await disposeCliContext(ctx)
		exit(0)
	}

	ctx.controller.enableInteractiveGoals()
	await runInkApp(
		React.createElement(App, {
			view: "history",
			historyItems: [],
			historyAllItems: sortedHistory,
			controller: ctx.controller,
			historyPagination: { page: initialPage, totalPages, totalCount, limit },
			isRawModeSupported: checkRawModeSupport(),
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(0)
		},
	)
}

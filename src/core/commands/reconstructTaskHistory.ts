import { getSavedDiracMessages, getTaskMetadata, writeTaskHistoryToState } from "@core/storage/disk"
import type { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { HostProvider } from "@hosts/host-provider"
import { DiracMessage, DiracMessageType } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { ShowMessageType } from "@shared/proto/host/window"
import { fileExistsAtPath } from "@utils/fs"
import * as path from "path"
import { getErrorMessage } from "@/shared/errors"
import { Logger } from "@/shared/services/Logger"

interface TaskReconstructionResult {
	totalTasks: number
	reconstructedTasks: number
	skippedTasks: number
	errors: string[]
}

/**
 * Reconstructs task history from existing task folders
 * @param showNotifications Whether to show user-facing notifications and dialogs
 * @param options Salvaged ULIDs and other recovery inputs
 * @returns Reconstruction result or null if cancelled
 */
export type TaskHistoryReconstructionOptions = {
	/**
	 * ULIDs salvaged from an unparseable task history file, keyed by task id.
	 * A ULID is the session that owns the task; an invented one hides the task from it.
	 */
	salvagedUlids?: Map<string, string>
}

export async function reconstructTaskHistory(
	showNotifications = true,
	options: TaskHistoryReconstructionOptions = {},
): Promise<TaskReconstructionResult | null> {
	try {
		// Show confirmation dialog using HostProvider
		const proceed = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message:
				"This will rebuild your task history from existing task data. This operation will backup your current task history and attempt to reconstruct it from task folders. Continue?",
			options: {
				items: ["Yes, Reconstruct", "Cancel"],
			},
		})

		if (proceed?.selectedOption !== "Yes, Reconstruct") {
			return null
		}

		if (showNotifications) {
			// Show initial progress message
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Reconstructing task history...",
			})
		}

		const result = await performTaskHistoryReconstruction(options)

		// Show results
		if (showNotifications) {
			if (result.errors.length > 0) {
				const errorMessage = `Reconstruction completed with warnings:\n- Reconstructed: ${result.reconstructedTasks} tasks\n- Skipped: ${result.skippedTasks} tasks\n- Errors: ${result.errors.length}\n\nFirst few errors:\n${result.errors.slice(0, 3).join("\n")}`

				HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: errorMessage,
				})
			} else {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: `Task history successfully reconstructed! Found and restored ${result.reconstructedTasks} tasks.`,
				})
			}
		}

		return result
	} catch (error) {
		const errorMessage = getErrorMessage(error)
		if (showNotifications) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to reconstruct task history: ${errorMessage}`,
			})
		}
		return null
	}
}

async function performTaskHistoryReconstruction(options: TaskHistoryReconstructionOptions): Promise<TaskReconstructionResult> {
	const result: TaskReconstructionResult = {
		totalTasks: 0,
		reconstructedTasks: 0,
		skippedTasks: 0,
		errors: [],
	}

	// Backup existing task history
	await backupExistingTaskHistory()

	// Get tasks directory
	const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

	// Check if tasks directory exists
	if (!(await fileExistsAtPath(tasksDir))) {
		throw new Error("No tasks directory found. Nothing to reconstruct.")
	}

	// Scan for task directories
	const taskIds = await scanTaskDirectories(tasksDir)
	result.totalTasks = taskIds.length

	if (taskIds.length === 0) {
		throw new Error("No task directories found. Nothing to reconstruct.")
	}

	// Process each task
	const reconstructedItems: HistoryItem[] = []

	for (const taskId of taskIds) {
		try {
			const historyItem = await reconstructTaskHistoryItem(taskId, options.salvagedUlids)
			if (historyItem) {
				reconstructedItems.push(historyItem)
				result.reconstructedTasks++
			} else {
				result.skippedTasks++
			}
		} catch (error) {
			result.skippedTasks++
			const errorMsg = getErrorMessage(error)
			result.errors.push(`Task ${taskId}: ${errorMsg}`)
		}
	}

	// Sort by timestamp (newest first)
	reconstructedItems.sort((a, b) => b.ts - a.ts)

	// Write reconstructed history
	await writeTaskHistoryToState(reconstructedItems)

	return result
}

// Copies the raw task history file before reconstruction. That file is unparseable in exactly the
// situation reconstruction runs in, so it is copied verbatim and never parsed here.
async function backupExistingTaskHistory(): Promise<void> {
	try {
		const fs = await import("fs/promises")
		const historyPath = path.join(HostProvider.get().globalStorageFsPath, "state", "taskHistory.json")
		const contents = await fs.readFile(historyPath, "utf8")
		if (contents.trim().length === 0) {
			return
		}

		const backupPath = path.join(HostProvider.get().globalStorageFsPath, "state", `taskHistory.backup.${Date.now()}.json`)
		await fs.mkdir(path.dirname(backupPath), { recursive: true })
		await fs.writeFile(backupPath, contents)
	} catch (error) {
		// Non-fatal error, just log it
		Logger.warn("Failed to backup existing task history:", error)
	}
}

async function scanTaskDirectories(tasksDir: string): Promise<string[]> {
	const fs = await import("fs/promises")

	try {
		const entries = await fs.readdir(tasksDir, { withFileTypes: true })
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => /^\d+$/.test(name)) // Only numeric task IDs
	} catch (error) {
		throw new Error(`Failed to scan tasks directory: ${error}`)
	}
}

async function reconstructTaskHistoryItem(
	taskId: string,
	salvagedUlids: Map<string, string> | undefined,
): Promise<HistoryItem | null> {
	try {
		// Load UI messages to extract task info
		const diracMessages = await getSavedDiracMessages(taskId)
		if (diracMessages.length === 0) {
			return null // Skip empty tasks
		}

		// Load task metadata for token usage
		const metadata = await getTaskMetadata(taskId)

		// Extract task information
		const taskInfo = extractTaskInformation(diracMessages, metadata)

		// Create HistoryItem
		const historyItem: HistoryItem = {
			id: taskId,
			// Session key for this task. Only a salvaged ULID preserves the owning session; the task
			// id is a deterministic stand-in that stays resolvable, unlike a newly minted ULID.
			ulid: salvagedUlids?.get(taskId) ?? taskId,
			ts: taskInfo.timestamp,
			task: taskInfo.taskDescription,
			tokensIn: taskInfo.tokensIn,
			tokensOut: taskInfo.tokensOut,
			cacheWrites: taskInfo.cacheWrites,
			cacheReads: taskInfo.cacheReads,
			totalCost: taskInfo.totalCost,
			size: taskInfo.size,
			isFavorited: taskInfo.isFavorited,
			conversationHistoryDeletedRange: taskInfo.conversationHistoryDeletedRange,
		}

		return historyItem
	} catch (error) {
		throw new Error(`Failed to reconstruct task ${taskId}: ${error}`)
	}
}

interface TaskInfo {
	timestamp: number
	taskDescription: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	size?: number
	isFavorited?: boolean
	conversationHistoryDeletedRange?: [number, number]
}

function extractTaskInformation(diracMessages: DiracMessage[], metadata: TaskMetadata): TaskInfo {
	// Find the first user message (task description)
	const firstUserMessage = diracMessages.find(
		(msg) => msg.content.type === DiracMessageType.MARKDOWN && !msg.content.isReasoning && msg.content.content,
	)

	// Extract timestamp from first message or use task ID as fallback
	const timestamp = diracMessages.length > 0 ? diracMessages[0].ts : Date.now()

	// Extract task description
	let taskDescription = "Untitled Task"
	if (firstUserMessage?.content.type === DiracMessageType.MARKDOWN && firstUserMessage.content.content) {
		// Clean up the task description
		const cleanText = firstUserMessage.content.content
			.replace(/<task>\s*/g, "")
			.replace(/\s*<\/task>/g, "")
			.trim()

		const firstLine = cleanText.split("\n")[0]
		if (firstLine) {
			taskDescription = firstLine.substring(0, 100) // Limit length
		}
	}

	// Calculate token usage from API request messages
	let tokensIn = 0
	let tokensOut = 0
	let cacheWrites = 0
	let cacheReads = 0
	let totalCost = 0

	// Look for usage-carrying messages with token info
	const apiReqMessages = diracMessages.filter((msg) => msg.content.type === DiracMessageType.API_STATUS)

	for (const msg of apiReqMessages) {
		if (msg.content.type === DiracMessageType.API_STATUS) {
			const status = msg.content.status
			tokensIn += status.tokensIn || 0
			tokensOut += status.tokensOut || 0
			cacheWrites += status.cacheWrites || 0
			cacheReads += status.cacheReads || 0
			totalCost += status.cost || 0
		}
	}

	// Use metadata if available and no tokens found in messages
	if (tokensIn === 0 && tokensOut === 0 && metadata.model_usage) {
		for (const usage of metadata.model_usage) {
			tokensIn += usage.tokensIn || 0
			tokensOut += usage.tokensOut || 0
			cacheWrites += usage.cacheWrites || 0
			cacheReads += usage.cacheReads || 0
			totalCost += usage.totalCost || 0
		}
	}

	// Calculate approximate size (rough estimate)
	const messageSize = JSON.stringify(diracMessages).length
	const size = Math.floor(messageSize / 1024) // KB

	return {
		timestamp,
		taskDescription,
		tokensIn,
		tokensOut,
		cacheWrites: cacheWrites > 0 ? cacheWrites : undefined,
		cacheReads: cacheReads > 0 ? cacheReads : undefined,
		totalCost,
		size,
	}
}

import fs from "node:fs/promises"
import path from "node:path"
import { initialGoalDisplayText, reconstructTaskHistoryItem } from "./reconstructTaskHistory"
import { createGoalHistoryItem } from "@core/goal/GoalHistory"
import { assertGoalRecord } from "@core/goal/validateGoalRecord"
import type { StateManager } from "@core/storage/StateManager"
import { getSavedDiracMessages, getTaskDirectoryPath, listTaskDirectoryIds } from "@core/storage/disk"
import type { GoalRecord } from "@shared/goal"
import type { RunHistoryItem } from "@shared/HistoryItem"
import { fileExistsAtPath } from "@utils/fs"
import { getErrorMessage } from "@/shared/errors"
import { Logger } from "@/shared/services/Logger"
import { tryAcquireTaskHistoryInventoryLease } from "@core/storage/taskHistory"

const STANDALONE_TIMESTAMP_ID = /^\d{13}$/
const STANDALONE_UUID_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const RECONSTRUCTION_WORKERS = 4

export interface TaskHistoryRepairResult {
	status: "completed" | "skipped"
	recovered: number
	skipped: number
	errors: number
}

interface GoalInventory {
	currentGoals: GoalRecord[]
	goalDirectoryIds: Set<string>
	childIds: Set<string>
	errors: number
}

export async function repairMissingTaskHistory(stateManager: StateManager): Promise<TaskHistoryRepairResult> {
	const release = await tryAcquireTaskHistoryInventoryLease()
	if (!release) {
		Logger.info("[Task History Repair] Another Dirac instance owns the repair lease; skipping this scan")
		return { status: "skipped", recovered: 0, skipped: 0, errors: 0 }
	}

	try {
		return await repairMissingTaskHistoryWithLease(stateManager)
	} finally {
		await release()
	}
}

async function repairMissingTaskHistoryWithLease(stateManager: StateManager): Promise<TaskHistoryRepairResult> {
	const taskIds = await listTaskDirectoryIds()
	const existingIds = new Set(stateManager.getGlobalStateKey("taskHistory").map((item) => item.id))
	const goalInventory = await readGoalInventory(taskIds)
	const recovered: RunHistoryItem[] = []
	let skipped = 0
	let errors = goalInventory.errors

	for (const goal of goalInventory.currentGoals) {
		if (existingIds.has(goal.id)) continue
		try {
			const messages = await getSavedDiracMessages(goal.id)
			recovered.push(createGoalHistoryItem(goal, initialGoalDisplayText(messages, goal.objective.markdown)))
		} catch (error) {
			errors++
			Logger.warn(`[Task History Repair] Could not reconstruct Goal ${goal.id}: ${getErrorMessage(error)}`)
		}
	}

	const ordinaryCandidateIds = taskIds.filter((taskId) => {
		if (existingIds.has(taskId)) return false
		if (goalInventory.goalDirectoryIds.has(taskId) || goalInventory.childIds.has(taskId)) return false
		if (isStandaloneTaskId(taskId)) return true
		skipped++
		return false
	})
	const ordinaryResult = await reconstructOrdinaryTasks(ordinaryCandidateIds)
	recovered.push(...ordinaryResult.items)
	skipped += ordinaryResult.skipped
	errors += ordinaryResult.errors

	const existingDirectories = await filterExistingRunDirectories(recovered)
	if (existingDirectories.length > 0) {
		stateManager.insertMissingTaskHistoryItems(existingDirectories)
		await stateManager.flushPendingState()
	}

	Logger.info(
		`[Task History Repair] Completed: recovered ${existingDirectories.length}, skipped ${skipped}, errors ${errors}`,
	)
	return { status: "completed", recovered: existingDirectories.length, skipped, errors }
}

async function readGoalInventory(taskIds: string[]): Promise<GoalInventory> {
	const currentGoals: GoalRecord[] = []
	const goalDirectoryIds = new Set<string>()
	const childIds = new Set<string>()
	let errors = 0

	for (const taskId of taskIds) {
		const goalPath = path.join(getTaskDirectoryPath(taskId), "goal.json")
		let parsed: unknown
		try {
			parsed = JSON.parse(await fs.readFile(goalPath, "utf8"))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
			goalDirectoryIds.add(taskId)
			errors++
			Logger.warn(`[Task History Repair] Could not read Goal record ${taskId}: ${getErrorMessage(error)}`)
			continue
		}

		goalDirectoryIds.add(taskId)
		collectChildIds(parsed, childIds)
		if (isSupersededGoalRecord(parsed)) continue
		try {
			assertGoalRecord(parsed, taskId)
			currentGoals.push(parsed)
		} catch (error) {
			errors++
			Logger.warn(`[Task History Repair] Ignoring invalid Goal record ${taskId}: ${getErrorMessage(error)}`)
		}
	}

	return { currentGoals, goalDirectoryIds, childIds, errors }
}

async function reconstructOrdinaryTasks(
	taskIds: string[],
): Promise<{ items: RunHistoryItem[]; skipped: number; errors: number }> {
	const items: RunHistoryItem[] = []
	let skipped = 0
	let errors = 0
	let nextIndex = 0
	const workers = Array.from({ length: Math.min(RECONSTRUCTION_WORKERS, taskIds.length) }, async () => {
		while (nextIndex < taskIds.length) {
			const taskId = taskIds[nextIndex++]
			try {
				const item = await reconstructTaskHistoryItem(taskId)
				if (item) items.push(item)
				else skipped++
			} catch (error) {
				errors++
				Logger.warn(`[Task History Repair] Could not reconstruct Task ${taskId}: ${getErrorMessage(error)}`)
			}
		}
	})
	await Promise.all(workers)
	return { items, skipped, errors }
}

async function filterExistingRunDirectories(items: RunHistoryItem[]): Promise<RunHistoryItem[]> {
	const checks = await Promise.all(
		items.map(async (item) => ({ item, exists: await fileExistsAtPath(getTaskDirectoryPath(item.id)) })),
	)
	return checks.filter(({ exists }) => exists).map(({ item }) => item)
}

function collectChildIds(value: unknown, childIds: Set<string>): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) return
	const children = (value as Record<string, unknown>).children
	if (!Array.isArray(children)) return
	for (const child of children) {
		if (!child || typeof child !== "object" || Array.isArray(child)) continue
		const id = (child as Record<string, unknown>).id
		if (typeof id === "string" && id.length > 0) childIds.add(id)
	}
}

function isSupersededGoalRecord(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false
	const record = value as Record<string, unknown>
	return record.version === undefined && typeof record.schemaVersion === "number"
}

function isStandaloneTaskId(taskId: string): boolean {
	return STANDALONE_TIMESTAMP_ID.test(taskId) || STANDALONE_UUID_ID.test(taskId)
}

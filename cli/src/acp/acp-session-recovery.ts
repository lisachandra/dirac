import fs from "node:fs"
import path from "node:path"
import { DIRAC_CLI_DIR } from "../utils/path.js"
import { getSessionRuntimeConfig } from "./acp-session-runtime-config.js"

const TASKS_DIRECTORY = "tasks"

// Task directories are named with the epoch milliseconds at which the task started, which is a
// moment after the session runtime config records its own start. Measured session-to-task delays
// are under three seconds; the wider bound only guards against clock granularity.
const MAX_TASK_START_DELAY_MS = 10_000

/**
 * Resolve the task a session was running before its session-to-task mapping was lost.
 *
 * Task history keys a session by ULID, so a session whose ULIDs were destroyed cannot be found
 * there. The runtime config keeps the session start time and a task directory name keeps the task
 * start time, which is enough to identify the task that session started.
 */
export function resolveTaskIdFromRuntimeConfig(sessionId: string): string | undefined {
	const createdAt = getSessionRuntimeConfig(DIRAC_CLI_DIR.data, sessionId)?.createdAt
	if (createdAt === undefined) return undefined

	const tasksDirectory = path.join(DIRAC_CLI_DIR.data, TASKS_DIRECTORY)
	if (!fs.existsSync(tasksDirectory)) return undefined

	let resolvedTaskId: string | undefined
	let smallestDelay = Number.POSITIVE_INFINITY
	for (const taskId of fs.readdirSync(tasksDirectory)) {
		if (!/^\d+$/.test(taskId)) continue
		const delay = Number(taskId) - createdAt
		if (delay < 0 || delay > MAX_TASK_START_DELAY_MS || delay >= smallestDelay) continue
		smallestDelay = delay
		resolvedTaskId = taskId
	}
	return resolvedTaskId
}

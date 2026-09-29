/**
 * Budgets for waiting on a task to finish (re)initialization.
 *
 * Resuming a task is not instant: it re-reads `ui_messages.json` and
 * `api_conversation_history.json`, rescans task-scoped tools, loads task
 * metadata, and can run `TaskResume` hooks. On multi-megabyte transcripts over
 * slow filesystems this routinely takes longer than a few seconds.
 *
 * A short budget does not fail fast here, it fails *loudly and wrongly*: the
 * caller rejects the turn, the next request re-enters rehydration from scratch
 * and the clock restarts, so the session livelocks instead of recovering.
 */

/** How long a cold task rehydration may take before callers give up. */
export const TASK_INITIALIZATION_TIMEOUT_MS = 30_000

/**
 * Build a p-wait-for timeout whose failure names the task instead of surfacing
 * the raw `Promise timed out after 3000 milliseconds` from p-timeout.
 */
export function taskInitializationTimeout(taskId: string): { milliseconds: number; message: string } {
	return {
		milliseconds: TASK_INITIALIZATION_TIMEOUT_MS,
		message: `Task ${taskId} did not finish initializing within ${TASK_INITIALIZATION_TIMEOUT_MS}ms`,
	}
}

import { createHash } from "node:crypto"
import { DiracMessageType, type DiracMessage } from "@shared/ExtensionMessage"
import type { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export const MAX_COMPLETION_VERIFICATION_TASK_CHARS = 8_000

const TASK_WRAPPER_PATTERN = /<task>([\s\S]*?)<\/task>/i

function normalizeInitialTask(task: string | undefined): string | undefined {
	const trimmed = task?.trim()
	if (!trimmed) return undefined
	const wrappedTask = TASK_WRAPPER_PATTERN.exec(trimmed)?.[1].trim()
	return wrappedTask || trimmed
}

function earliestUserTask(history: readonly DiracMessage[]): string | undefined {
	const firstUserMessage = history.find(
		(message) => message.content.type === DiracMessageType.MARKDOWN && message.content.role === "user",
	)
	return firstUserMessage?.content.type === DiracMessageType.MARKDOWN
		? normalizeInitialTask(firstUserMessage.content.content)
		: undefined
}

/** Resolves one task preview for both same-agent and subagent completion verification. */
export function completionVerificationTaskPreview(env: IToolEnvironment): string | undefined {
	const initialTask = normalizeInitialTask(env.orchestration.getTaskState("initialTask"))
	const task = initialTask ?? earliestUserTask(env.orchestration.getHistory())
	if (!task) return undefined
	return task.length > MAX_COMPLETION_VERIFICATION_TASK_CHARS
		? `${task.slice(0, MAX_COMPLETION_VERIFICATION_TASK_CHARS)}\n...[truncated]`
		: task
}

export function formatPreviousVerificationFailures(reports: readonly string[]): string {
	if (reports.length === 0) return ""
	const failures = reports.map((report, index) => `Failure ${index + 1}:\n${report}`).join("\n\n")
	return `\n\n<previous_verification_failures>\n${failures}\n</previous_verification_failures>\n\nThe candidate changed after these failures. Explicitly verify that every prior failure has been addressed.`
}

export async function completionVerificationCandidateFingerprint(
	env: IToolEnvironment,
	completionResult: string,
): Promise<string> {
	const workspaceFingerprint = await env.workspace.fingerprintWorkspace()
	return createHash("sha256")
		.update(JSON.stringify({ completionResult, workspaceFingerprint }))
		.digest("hex")
}

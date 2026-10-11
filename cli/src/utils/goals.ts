import { type GoalStatus, isResumableGoalStatus as isResumableStatus } from "@shared/goal"

export const UNSUPPORTED_GOAL_CLI_MESSAGE = "Goals require the interactive Ink CLI; plain-text CLI and ACP are unsupported."

export type GoalLifecycleAction = "pause" | "resume" | "stop"

export function isGoalRequest(text: string | undefined): boolean {
	return /^\s*\/goal(?:\s|$)/.test(text ?? "")
}

export function isRunningGoalStatus(status: GoalStatus | undefined): boolean {
	return status === "working" || status === "waiting"
}

export function isResumableGoalStatus(status: GoalStatus | undefined): boolean {
	return status !== undefined && isResumableStatus(status)
}

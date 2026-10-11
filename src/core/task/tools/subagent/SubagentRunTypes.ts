import type { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type { SubagentTrajectoryEvent } from "@shared/subagents"
import type { SubagentRunPhase } from "./SubagentRunRecorder"

export type SubagentRunStatus =
	| typeof SubagentExecutionStatus.COMPLETED
	| typeof SubagentExecutionStatus.FAILED
	| typeof SubagentExecutionStatus.CANCELLED

export interface SubagentRunResult {
	status: SubagentRunStatus
	result?: string
	error?: string
	stats: SubagentRunStats
}

export interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	latestToolCall?: string
	status?: SubagentExecutionStatus
	result?: string
	error?: string
	textChunk?: string
	trajectoryEvent?: SubagentTrajectoryEvent
	isWrappingUp?: boolean
	phase?: SubagentRunPhase
	phaseStartedAt?: number
	lastActivityAt?: number
	isStalled?: boolean
	transcriptPath?: string
	diagnosticsPath?: string
}

export interface SubagentRunStats {
	toolCalls: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
}

export interface SubagentRequestUsageState {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalTokens: number
	totalCost?: number
}

export interface SubagentUsageState {
	currentRequest: SubagentRequestUsageState
	lastRequest?: SubagentRequestUsageState
}

export interface SubagentToolCall {
	toolUseId: string
	id?: string
	call_id?: string
	signature?: string
	name: string
	input: unknown
	isNativeToolCall: boolean
}

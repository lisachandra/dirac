import type { TaskConfig } from "../types/TaskConfig"
import type { SubagentRunProgress } from "./SubagentRunProgress"
import type { SubagentRunPhase } from "./SubagentRunRecorder"
import type { SubagentProgressUpdate, SubagentRunStatus } from "./SubagentRunTypes"

const SUBAGENT_HEARTBEAT_INTERVAL_MS = 5_000
const SUBAGENT_STALL_WARNING_MS = 30_000

export class SubagentRunState {
	currentPhase: SubagentRunPhase = "starting"
	phaseStartedAt = 0
	lastActivityAt = 0
	lastMeaningfulAction = "not started"
	currentAttempt: number | undefined
	livenessWarningIssued = false
	activeCommandExecutions = 0

	private heartbeatHandle: NodeJS.Timeout | undefined

	constructor(
		private readonly baseConfig: TaskConfig,
		private readonly progress: SubagentRunProgress,
	) {}

	reset(): void {
		this.stopHeartbeat()
		this.currentPhase = "starting"
		this.phaseStartedAt = 0
		this.lastActivityAt = 0
		this.lastMeaningfulAction = "run initialized"
		this.currentAttempt = undefined
		this.livenessWarningIssued = false
		this.activeCommandExecutions = 0
	}

	enterPhase(phase: SubagentRunPhase, action: string, details: Record<string, unknown> = {}): void {
		const previousPhase = this.currentPhase
		const previousPhaseStartedAt = this.phaseStartedAt
		if (previousPhase === phase && previousPhaseStartedAt > 0) {
			this.markActivity(action)
			return
		}
		const now = Date.now()
		if (previousPhase !== phase && previousPhaseStartedAt > 0) {
			this.progress.recordDiagnostic(
				"phase_completed",
				previousPhase,
				this.getDiagnosticDetails({
					completedPhase: previousPhase,
					nextPhase: phase,
					durationMs: now - previousPhaseStartedAt,
				}),
			)
		}
		this.currentPhase = phase
		this.phaseStartedAt = now
		this.lastActivityAt = now
		this.lastMeaningfulAction = action
		this.livenessWarningIssued = false
		this.progress.recordDiagnostic("phase_entered", phase, this.getDiagnosticDetails(details))
		this.progress.publishRuntimeState(this.getRuntimeProgress())
	}

	markActivity(action: string): void {
		const wasStalled = this.getRuntimeProgress().isStalled
		this.lastActivityAt = Date.now()
		this.lastMeaningfulAction = action
		this.livenessWarningIssued = false
		if (wasStalled) {
			this.progress.publishRuntimeState(this.getRuntimeProgress())
		}
	}

	startHeartbeat(): void {
		this.heartbeatHandle = setInterval(() => this.heartbeat(), SUBAGENT_HEARTBEAT_INTERVAL_MS)
	}

	stopHeartbeat(): void {
		if (this.heartbeatHandle) {
			clearInterval(this.heartbeatHandle)
			this.heartbeatHandle = undefined
		}
	}

	private heartbeat(): void {
		const runtime = this.getRuntimeProgress()
		this.progress.recordDiagnostic(
			"heartbeat",
			this.currentPhase,
			this.getDiagnosticDetails({ isStalled: runtime.isStalled }),
		)
		if (!runtime.isStalled || this.livenessWarningIssued) return
		this.livenessWarningIssued = true
		this.progress.recordDiagnostic(
			"liveness_warning",
			this.currentPhase,
			this.getDiagnosticDetails({ inactiveForMs: Date.now() - this.lastActivityAt }),
		)
		this.progress.publishRuntimeState(runtime)
	}

	getRuntimeProgress(): Pick<
		SubagentProgressUpdate,
		"phase" | "phaseStartedAt" | "lastActivityAt" | "isStalled" | "transcriptPath" | "diagnosticsPath"
	> {
		const paths = this.progress.getPaths()
		return {
			phase: this.currentPhase,
			phaseStartedAt: this.phaseStartedAt,
			lastActivityAt: this.lastActivityAt,
			isStalled:
				this.currentPhase !== "completed" &&
				this.currentPhase !== "failed" &&
				this.currentPhase !== "cancelled" &&
				Date.now() - this.lastActivityAt >= SUBAGENT_STALL_WARNING_MS,
			transcriptPath: paths?.transcriptPath,
			diagnosticsPath: paths?.diagnosticsPath,
		}
	}

	getDiagnosticDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			...details,
			phaseStartedAt: this.phaseStartedAt,
			lastActivityAt: this.lastActivityAt,
			elapsedMs: Math.max(0, Date.now() - this.phaseStartedAt),
			lastMeaningfulAction: this.lastMeaningfulAction,
			attempt: this.currentAttempt,
			activeCommandExecutions: this.activeCommandExecutions,
			parentAbortRequested: this.baseConfig.taskState.abort,
		}
	}

	phaseForStatus(status: SubagentRunStatus): SubagentRunPhase {
		if (status === "completed") return "completed"
		if (status === "failed") return "failed"
		return "cancelled"
	}
}

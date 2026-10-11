import { Logger } from "@shared/services/Logger"
import type {
	SubagentDiagnosticEvent,
	SubagentRunPhase,
	SubagentRunRecorder,
	SubagentTranscriptEvent,
} from "./SubagentRunRecorder"
import type { SubagentProgressUpdate, SubagentRunResult } from "./SubagentRunTypes"

const PROGRESS_UPDATE_DRAIN_TIMEOUT_MS = 1_000

export class SubagentRunProgress {
	private onProgress?: (update: SubagentProgressUpdate) => void | Promise<void>
	private acceptsExecutionProgress = true
	private discardQueuedExecutionProgress = false
	private progressUpdates = Promise.resolve()
	private terminalRecorded = false
	private recorderFailureReported = false

	constructor(
		private readonly recorder: SubagentRunRecorder | undefined,
		private readonly logPrefix: string,
	) {}

	getPaths() {
		return this.recorder?.getPaths()
	}

	beginExecution(onProgress: (update: SubagentProgressUpdate) => void | Promise<void>): void {
		this.onProgress = onProgress
		this.acceptsExecutionProgress = true
		this.discardQueuedExecutionProgress = false
		this.progressUpdates = Promise.resolve()
		this.terminalRecorded = false
		this.recorderFailureReported = false
	}

	endExecution(): void {
		this.onProgress = undefined
		this.acceptsExecutionProgress = false
	}

	stopAcceptingUpdates(): void {
		this.acceptsExecutionProgress = false
	}

	discardQueuedUpdates(): void {
		this.discardQueuedExecutionProgress = true
	}

	enqueueExecutionProgress(update: SubagentProgressUpdate): void {
		const onProgress = this.onProgress
		if (!this.acceptsExecutionProgress || !onProgress) return
		this.progressUpdates = this.progressUpdates
			.then(async () => {
				if (this.discardQueuedExecutionProgress) return
				await onProgress(update)
			})
			.catch((error) => Logger.error(`${this.logPrefix} progress observer failed`, error))
	}

	publishRuntimeState(runtimeProgress: SubagentProgressUpdate): void {
		this.enqueueExecutionProgress(runtimeProgress)
	}

	async drainProgressUpdates(progressUpdates?: Promise<void>, logPrefix = this.logPrefix): Promise<boolean> {
		const updates = progressUpdates ?? this.progressUpdates
		let progressDrainTimeout: NodeJS.Timeout | undefined
		const progressUpdatesDrained = await Promise.race([
			updates.then(() => true),
			new Promise<boolean>((resolve) => {
				progressDrainTimeout = setTimeout(() => resolve(false), PROGRESS_UPDATE_DRAIN_TIMEOUT_MS)
			}),
		])
		if (progressDrainTimeout) clearTimeout(progressDrainTimeout)
		if (!progressUpdatesDrained) {
			Logger.warn(`${logPrefix} progress observer did not drain within ${PROGRESS_UPDATE_DRAIN_TIMEOUT_MS}ms`)
		}
		return progressUpdatesDrained
	}

	toTerminalProgressUpdate(result: SubagentRunResult, runtimeProgress: SubagentProgressUpdate): SubagentProgressUpdate {
		return {
			...runtimeProgress,
			status: result.status,
			result: result.result,
			error: result.error,
			stats: { ...result.stats },
		}
	}

	recordTranscript(type: SubagentTranscriptEvent["type"], details: Record<string, unknown>): void {
		if (!this.recorder) return
		void this.recorder.recordTranscript({ type, details }).catch((error) => this.reportRecorderFailure(error))
	}

	recordDiagnostic(type: SubagentDiagnosticEvent["type"], phase: SubagentRunPhase, details: Record<string, unknown>): void {
		if (!this.recorder) return
		void this.recorder.recordDiagnostic({ type, phase, details }).catch((error) => this.reportRecorderFailure(error))
	}

	recordTerminal(result: SubagentRunResult, details: Record<string, unknown>): void {
		if (this.terminalRecorded) return
		this.terminalRecorded = true
		if (!this.recorder) return
		void this.recorder.recordTerminal(result.status, details).catch((error) => this.reportRecorderFailure(error))
	}

	async flush(): Promise<void> {
		if (!this.recorder) return
		try {
			await this.recorder.flush()
		} catch (error) {
			this.reportRecorderFailure(error)
		}
	}

	reportRecorderFailure(error: unknown): void {
		if (this.recorderFailureReported) return
		this.recorderFailureReported = true
		Logger.error(`${this.logPrefix} recorder append failed`, error)
	}
}

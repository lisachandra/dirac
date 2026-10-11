import { SubagentExecutionStatus } from "@shared/ExtensionMessage"
import type { DiracStorageMessage } from "@shared/messages"
import { type SubagentRunResult, type SubagentRunStats } from "./SubagentRunTypes"

// Constructs the authoritative result for a subagent stopped by timeout or cancellation.
export class SubagentAbortHandler {
	constructor(
		private getAbortReason: () => string | undefined,
		private getBestEffortResult: (conversation: DiracStorageMessage[]) => string,
	) {}

	buildAbortResult(conversation: DiracStorageMessage[], stats: SubagentRunStats): SubagentRunResult {
		const reason = this.getAbortReason() || "Subagent run cancelled."
		const finalStats = { ...stats }
		if (/timed out/.test(reason)) {
			const partialResult = this.getBestEffortResult(conversation)
			const result = `${reason} This is what I have currently:\n\n${partialResult}`
			return { status: SubagentExecutionStatus.COMPLETED, result, stats: finalStats }
		}
		return { status: SubagentExecutionStatus.CANCELLED, error: reason, stats: finalStats }
	}
}

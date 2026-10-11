import type { UtilityModelUsageEvent } from "@core/utility-model/UtilityModelRunner"
import { telemetryService } from "@services/telemetry"
import type { TaskState } from "./TaskState"

/** Records one utility-model usage chunk in the owning Task's cumulative session counters. */
export function recordUtilityModelUsage(taskState: TaskState, ulid: string, event: UtilityModelUsageEvent): void {
	const { selection, usage } = event
	taskState.utilityModelUsageObserved = true
	taskState.utilityPermissionInputTokens += usage.inputTokens
	taskState.utilityPermissionOutputTokens += usage.outputTokens
	taskState.utilityModelReasoningTokens += usage.reasoningTokens ?? usage.thoughtsTokenCount ?? 0
	taskState.utilityPermissionCacheWriteTokens += usage.cacheWriteTokens ?? 0
	taskState.utilityPermissionCacheReadTokens += usage.cacheReadTokens ?? 0
	taskState.utilityPermissionCost += usage.totalCost ?? 0
	taskState.utilityModelReasoningAvailable &&=
		usage.reasoningTokens !== undefined || usage.thoughtsTokenCount !== undefined
	taskState.utilityModelCacheWriteAvailable &&= usage.cacheWriteTokens !== undefined
	taskState.utilityModelCacheReadAvailable &&= usage.cacheReadTokens !== undefined
	taskState.utilityModelCostAvailable &&= usage.totalCost !== undefined

	telemetryService.captureTokenUsage(
		ulid,
		usage.inputTokens,
		usage.outputTokens,
		selection.provider,
		selection.modelId,
		{
			cacheWriteTokens: usage.cacheWriteTokens,
			cacheReadTokens: usage.cacheReadTokens,
			totalCost: usage.totalCost,
		},
	)
}

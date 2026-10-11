import type { GoalAccounting, GoalRecord } from "@shared/goal"

const ACCOUNTING_FIELDS = [
	"totalTokens",
	"inputTokens",
	"outputTokens",
	"reasoningTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"cost",
] as const satisfies readonly (keyof GoalAccounting)[]

export function calculateGoalAccounting(sources: Readonly<Record<string, GoalAccounting>>): GoalAccounting {
	const snapshots = Object.values(sources)
	if (snapshots.length === 0) return {}

	const aggregate: GoalAccounting = {}
	for (const field of ACCOUNTING_FIELDS) {
		if (snapshots.some((snapshot) => snapshot[field] === undefined)) continue
		aggregate[field] = snapshots.reduce((sum, snapshot) => sum + (snapshot[field] as number), 0)
	}
	return aggregate
}

/** Replaces one cumulative source snapshot so repeated history flushes cannot double count it. */
export function replaceGoalAccountingSource(record: GoalRecord, sourceId: string, snapshot: GoalAccounting): void {
	if (!sourceId) throw new Error("Goal accounting source identity cannot be empty")
	record.accountingSources[sourceId] = structuredClone(snapshot)
	record.accounting = calculateGoalAccounting(record.accountingSources)
}

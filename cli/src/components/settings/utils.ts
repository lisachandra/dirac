import {
	DEFAULT_OPENAI_REASONING_EFFORT,
	isOpenaiReasoningEffort,
	OPENAI_REASONING_EFFORT_OPTIONS,
	type OpenaiReasoningEffort,
} from "@shared/storage/types"

export function normalizeReasoningEffort(value: unknown): OpenaiReasoningEffort {
	if (isOpenaiReasoningEffort(value)) {
		return value
	}
	return DEFAULT_OPENAI_REASONING_EFFORT
}

export function nextReasoningEffort(
	current: OpenaiReasoningEffort,
	options: readonly OpenaiReasoningEffort[] = OPENAI_REASONING_EFFORT_OPTIONS,
): OpenaiReasoningEffort {
	const idx = options.indexOf(current)
	return options[(idx + 1) % options.length]
}

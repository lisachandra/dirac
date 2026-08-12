import { InvalidArgumentError } from "commander"
import {
	isOpenaiReasoningEffort,
	OPENAI_REASONING_EFFORT_OPTIONS,
	type OpenaiReasoningEffort,
} from "@/shared/storage/types"

export function parsePositiveInteger(value: string): number {
	const parsed = Number(value)
	if (value.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 1) {
		throw new InvalidArgumentError("Value must be a whole number greater than zero")
	}
	return parsed
}

export function parseNonNegativeInteger(value: string): number {
	const parsed = Number(value)
	if (value.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 0) {
		throw new InvalidArgumentError("Value must be a non-negative whole number")
	}
	return parsed
}

export function parseThinkingBudget(value: string): number {
	const parsed = Number(value)
	if (value.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 0) {
		throw new InvalidArgumentError("Thinking budget must be a non-negative whole number of tokens")
	}
	return parsed
}

export function parseReasoningEffort(value: string): OpenaiReasoningEffort {
	const normalizedValue = value.toLowerCase()
	if (!isOpenaiReasoningEffort(normalizedValue)) {
		throw new InvalidArgumentError(`Reasoning effort must be one of: ${OPENAI_REASONING_EFFORT_OPTIONS.join(", ")}`)
	}
	return normalizedValue
}

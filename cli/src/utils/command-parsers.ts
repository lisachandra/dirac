import { InvalidArgumentError } from "commander"
import {
	isOpenaiReasoningEffort,
	isInferenceSpeed,
	INFERENCE_SPEED_OPTIONS,
	type InferenceSpeed,
	OPENAI_REASONING_EFFORT_OPTIONS,
	type OpenaiReasoningEffort,
} from "@/shared/storage/types"

export function parseToolIdentifiers(value: string, previous: string[] = []): string[] {
	const identifiers = value.split(",").map((identifier) => identifier.trim())
	if (identifiers.some((identifier) => identifier.length === 0)) {
		throw new InvalidArgumentError("Tool lists must contain non-empty comma-separated identifiers")
	}
	return [...new Set([...previous, ...identifiers])]
}

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

export function parseInferenceSpeed(value: string): InferenceSpeed {
	const normalizedValue = value.toLowerCase()
	if (!isInferenceSpeed(normalizedValue)) {
		throw new InvalidArgumentError(`Inference speed must be one of: ${INFERENCE_SPEED_OPTIONS.join(", ")}`)
	}
	return normalizedValue
}

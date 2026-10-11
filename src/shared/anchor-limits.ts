export const MAX_ANCHORED_FILE_LINES = 50_000
export const MAX_ANCHORED_FILE_BYTES = 20 * 1024 * 1024

export function anchorLimitMessage(lineCount: number): string {
	return `The file has ${lineCount.toLocaleString()} lines, which exceeds the ${MAX_ANCHORED_FILE_LINES.toLocaleString()}-line hash-anchoring limit. Hash anchors and edit_file are unavailable for this file; use execute_command to modify it.`
}

export function anchorByteLimitMessage(): string {
	return `The file exceeds the ${MAX_ANCHORED_FILE_BYTES / 1024 / 1024} MiB hash-anchoring limit. Hash anchors and edit_file are unavailable for this file; use execute_command to modify it.`
}

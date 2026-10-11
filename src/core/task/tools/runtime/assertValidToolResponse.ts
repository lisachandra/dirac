import type { ToolResponse } from "../types/ToolResponse"

const IMAGE_MEDIA_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

function invalidToolResponse(toolName: string, detail: string): Error {
	return new Error(`Tool '${toolName}' returned an invalid result: ${detail}`)
}

function assertValidImageSource(source: unknown, toolName: string, blockIndex: number): void {
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		throw invalidToolResponse(toolName, `image block ${blockIndex} must contain a source object`)
	}

	const candidate = source as Record<string, unknown>
	if (candidate.type === "base64") {
		if (typeof candidate.data !== "string") {
			throw invalidToolResponse(toolName, `base64 image block ${blockIndex} must contain string data`)
		}
		if (typeof candidate.media_type !== "string" || !IMAGE_MEDIA_TYPES.has(candidate.media_type)) {
			throw invalidToolResponse(toolName, `base64 image block ${blockIndex} has an unsupported media_type`)
		}
		return
	}

	if (candidate.type === "url") {
		if (typeof candidate.url !== "string" || candidate.url.length === 0) {
			throw invalidToolResponse(toolName, `URL image block ${blockIndex} must contain a non-empty URL`)
		}
		return
	}

	throw invalidToolResponse(toolName, `image block ${blockIndex} has an unsupported source type`)
}

export function assertValidToolResponse(value: unknown, toolName: string): asserts value is ToolResponse {
	if (typeof value === "string") return
	if (!Array.isArray(value)) {
		throw invalidToolResponse(toolName, "expected a string or an array of text/image blocks")
	}

	value.forEach((block, index) => {
		if (!block || typeof block !== "object" || Array.isArray(block)) {
			throw invalidToolResponse(toolName, `block ${index} must be an object`)
		}

		const candidate = block as Record<string, unknown>
		if (candidate.type === "text") {
			if (typeof candidate.text !== "string") {
				throw invalidToolResponse(toolName, `text block ${index} must contain string text`)
			}
			return
		}

		if (candidate.type === "image") {
			assertValidImageSource(candidate.source, toolName, index)
			return
		}

		throw invalidToolResponse(toolName, `block ${index} has unsupported type '${String(candidate.type)}'`)
	})
}

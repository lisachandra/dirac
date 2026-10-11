import type { Anthropic } from "@anthropic-ai/sdk"
import { type DiracContent, type DiracStorageMessage, removeProviderBoundaryMetadataFromMessage } from "@shared/messages/content"

function replaceUnsupportedImages(block: DiracContent): DiracContent {
	if (block.type === "image") {
		const sourceType = block.source.type
		const mediaType = block.source.type === "base64" ? block.source.media_type : "unknown"
		return {
			type: "text",
			text: `[Image (${sourceType}): ${mediaType} not supported by Claude Code]`,
		}
	}

	if (block.type === "tool_result" && Array.isArray(block.content)) {
		return {
			...block,
			content: block.content.map((contentBlock) => replaceUnsupportedImages(contentBlock as DiracContent)),
		} as DiracContent
	}

	if (block.type === "document" && block.source.type === "content" && Array.isArray(block.source.content)) {
		return {
			...block,
			source: {
				...block.source,
				content: block.source.content.map((contentBlock) => replaceUnsupportedImages(contentBlock as DiracContent)),
			},
		} as DiracContent
	}

	return block
}

/**
 * Filters out image blocks from messages since Claude Code doesn't support images.
 * Replaces direct and nested images with text placeholders.
 */
export function filterMessagesForClaudeCode(messages: DiracStorageMessage[]): Anthropic.Messages.MessageParam[] {
	return messages.map(removeProviderBoundaryMetadataFromMessage).map((message) => {
		if (typeof message.content === "string") {
			return message
		}

		return {
			...message,
			content: message.content.map((block) => replaceUnsupportedImages(block)),
		}
	})
}

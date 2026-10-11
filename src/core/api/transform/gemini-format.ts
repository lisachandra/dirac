import { GenerateContentResponse, Part, Content } from "@google/genai"
import { Anthropic } from "@anthropic-ai/sdk"
import { DiracImageContentBlock, DiracStorageMessage } from "@/shared/messages/content"

function supportsMultimodalFunctionResponses(modelId?: string): boolean {
	const majorVersion = Number(/^gemini-(\d+)/.exec(modelId || "")?.[1])
	return majorVersion >= 3
}

export function convertAnthropicMessagesToGemini(messages: DiracStorageMessage[], modelId?: string): Content[] {
	const toolUseIdToName = new Map<string, string>()

	for (const msg of messages) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (typeof block !== "string" && block.type === "tool_use") {
					toolUseIdToName.set(block.id, block.name)
				}
			}
		}
	}

	const useMultimodalFunctionResponses = supportsMultimodalFunctionResponses(modelId)
	return messages.map((message) => ({
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(
			message.content as DiracStorageMessage["content"],
			toolUseIdToName,
			useMultimodalFunctionResponses,
		),
	}))
}

function convertImageBlockToGemini(block: DiracImageContentBlock): Part {
	if (block.source.type === "url") {
		throw new Error("Gemini URL images must be resolved before message conversion")
	}

	return {
		inlineData: {
			mimeType: block.source.media_type,
			data: block.source.data,
		},
	}
}

function convertToolResultToGemini(
	block: any,
	toolUseIdToName: Map<string, string> | undefined,
	useMultimodalFunctionResponses: boolean,
): Part[] {
	const nestedContent = Array.isArray(block.content) ? block.content : []
	const textResult =
		typeof block.content === "string"
			? block.content
			: nestedContent
					.filter((contentBlock: any) => contentBlock.type === "text")
					.map((contentBlock: any) => contentBlock.text)
					.join("\n")
	const imageParts = nestedContent.filter((contentBlock: any) => contentBlock.type === "image").map(convertImageBlockToGemini)
	const functionResponse = {
		id: block.tool_use_id,
		name: toolUseIdToName?.get(block.tool_use_id) || block.tool_use_id,
		response: {
			result: textResult || (imageParts.length > 0 ? "[Image attached]" : ""),
		},
	}

	if (!useMultimodalFunctionResponses || imageParts.length === 0) {
		return [{ functionResponse }, ...imageParts]
	}

	return [
		{
			functionResponse: {
				...functionResponse,
				parts: imageParts,
			},
		},
	]
}

export function convertAnthropicContentToGemini(
	content: string | DiracStorageMessage["content"],
	toolUseIdToName?: Map<string, string>,
	useMultimodalFunctionResponses = false,
): Part[] {
	if (typeof content === "string") {
		return [{ text: content }]
	}

	let lastThoughtSignature: string | undefined

	return content.flatMap((block: any): Part[] => {
		if (block.signature) {
			lastThoughtSignature = block.signature
		}
		const signature = block.signature || lastThoughtSignature

		if (block.type === "text") {
			return [
				{
					text: block.text,
					thoughtSignature: signature,
				},
			]
		}
		if (block.type === "thinking") {
			return [
				{
					thought: true,
					text: block.thinking,
					thoughtSignature: signature,
				} as any,
			]
		}
		if (block.type === "image") {
			return [convertImageBlockToGemini(block)]
		}
		if (block.type === "tool_use") {
			return [
				{
					functionCall: {
						id: block.id,
						name: block.name,
						args: block.input as Record<string, unknown>,
					},
					thoughtSignature: signature,
				},
			]
		}
		if (block.type === "tool_result") {
			return convertToolResultToGemini(block, toolUseIdToName, useMultimodalFunctionResponses)
		}
		return []
	})
}

export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(message.content as DiracStorageMessage["content"]),
	}
}

export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n")
}

export function convertGeminiResponseToAnthropic(response: GenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	const text = response.text
	if (text) {
		content.push({ type: "text", text } as Anthropic.Messages.TextBlock)
	}

	let stop_reason: Anthropic.Messages.Message["stop_reason"] = null
	const finishReason = response.candidates?.[0]?.finishReason
	if (finishReason) {
		switch (finishReason) {
			case "STOP":
				stop_reason = "end_turn"
				break
			case "MAX_TOKENS":
				stop_reason = "max_tokens"
				break
			case "SAFETY":
			case "RECITATION":
			case "OTHER":
				stop_reason = "stop_sequence"
				break
		}
	}

	return {
		id: `msg_${Date.now()}`,
		type: "message",
		role: "assistant",
		content,
		model: "",
		stop_reason,
		stop_sequence: null, // Gemini doesn't provide this information
		container: null,
		stop_details: null,

		usage: {
			input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
			output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			cache_creation_input_tokens: undefined,
			cache_read_input_tokens: undefined,
			cache_creation: undefined,
			cache_read: undefined,
			inference_geo: undefined,
			server_tool_use: undefined,
			service_tier: undefined,
		} as any,
	}
}

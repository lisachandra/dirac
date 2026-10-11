import { OpenAiCodexAuthEvent, OpenAiCodexAuthMethod, OpenAiCodexAuthRequest } from "@shared/proto/dirac/models"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/** Stream public instructions followed by completion; disconnecting cancels the attempt. */
export async function authenticateOpenAiCodex(
	controller: Controller,
	request: OpenAiCodexAuthRequest,
	responseStream: StreamingResponseHandler<OpenAiCodexAuthEvent>,
	requestId?: string,
): Promise<void> {
	const abortController = new AbortController()
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => abortController.abort(),
			{ type: "openai_codex_auth" },
			responseStream,
		)
	}
	try {
		if (
			request.method !== OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_BROWSER &&
			request.method !== OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE
		) {
			throw new Error("Unknown ChatGPT sign-in method")
		}
		await openAiCodexOAuthManager.authenticate(
			request.method === OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE ? "device" : "browser",
			async ({ url, userCode }) => {
				await responseStream(OpenAiCodexAuthEvent.create({ url, userCode }))
			},
			abortController.signal,
		)
		abortController.signal.throwIfAborted()
		openAiCodexUsageService.clear()
		await controller.postStateToWebview()
		await responseStream(OpenAiCodexAuthEvent.create({ completed: true }), true)
	} catch (error) {
		if (!abortController.signal.aborted) throw error
	} finally {
		if (requestId) getRequestRegistry().cancelRequest(requestId)
	}
}

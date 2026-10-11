import { ApiStream } from "@core/api/transform/stream"
import { recordSuccessfulModelProviderPreset } from "@core/models/modelProviderPresets"
import type { ApiProvider } from "@shared/api"
import type { DiracApiReqCancelReason } from "@shared/ExtensionMessage"
import { TaskStatus } from "@shared/ExtensionMessage"
import { removeProviderBoundaryMetadataFromMessage } from "@shared/messages/content"
import type { DiracStorageMessage } from "@shared/messages/content"
import { StreamingMetricsManager } from "./StreamingMetricsManager"
import { buildApiRequestParams } from "./TaskRequestBuilder"
import { handleApiRequestError } from "./TaskRequestOutcome"
import { appendQueuedSteeringToNextApiRequest } from "./TaskSteering"
import type { TaskRequestLoopContext } from "./TaskRequestLoop"

export async function* attemptApiRequest(
	ctx: TaskRequestLoopContext,
	previousApiReqIndex: number,
	lastApiReqIndex: number,
	shouldCompact?: boolean,
): ApiStream {
	const { systemPrompt, toolSnapshot, contextManagementMetadata, providerInfo } = await buildApiRequestParams(
		ctx,
		ctx.requestRuntime,
		{
			previousApiReqIndex,
			shouldCompact,
		},
	)
	const { model, providerId } = providerInfo

	const metricsManager = new StreamingMetricsManager(ctx.messageStateHandler, lastApiReqIndex, ctx.requestRuntime.api)

	const finalizeApiReqMsg = async (cancelReason?: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
		await metricsManager.updateApiReqMsgFromMetrics(cancelReason, streamingFailedMessage)
		await ctx.messageStateHandler.updateDiracMessage(lastApiReqIndex, {})
		ctx.taskState.isApiRequestActive = false
		ctx.taskState.activeVoiceStreamId = undefined
	}

	const abortStream = async (cancelReason: DiracApiReqCancelReason, streamingFailedMessage?: string) => {
		ctx.taskState.didFinishAbortingStream = true
		await finalizeApiReqMsg(cancelReason, streamingFailedMessage)
		ctx.taskState.isApiRequestActive = false
		ctx.taskState.activeVoiceStreamId = undefined
	}

	await appendQueuedSteeringToNextApiRequest(ctx.steeringContext, contextManagementMetadata.truncatedConversationHistory)

	const providerDispatch = await ctx.apiConversationManager.prepareProviderConversationDispatch({
		systemPrompt,
		tools: toolSnapshot.nativeTools,
		truncatedMessages: contextManagementMetadata.truncatedConversationHistory as DiracStorageMessage[],
		providerId,
		modelId: model.id,
	})

	if (ctx.taskState.abort) throw new Error("Task instance aborted")

	const stream = ctx.requestRuntime.api.createMessage(
		systemPrompt,
		providerDispatch.messages.map(removeProviderBoundaryMetadataFromMessage),
		toolSnapshot.nativeTools,
		providerDispatch.options,
	)
	const iterator = stream[Symbol.asyncIterator]()

	try {
		ctx.taskState.status = TaskStatus.WAITING_FOR_API

		ctx.taskState.isWaitingForFirstChunk = true
		const firstChunk = await iterator.next()
		ctx.taskState.isWaitingForFirstChunk = false

		if (firstChunk.done) {
			await finalizeApiReqMsg()
			return
		}

		yield firstChunk.value

		for await (const chunk of iterator) {
			if (ctx.taskState.abort) {
				await abortStream("user_cancelled")
				return
			}

			if (chunk.type === "usage") {
				metricsManager.updateFromChunk(chunk)
				yield chunk
				continue
			}

			yield chunk
		}

		recordSuccessfulModelProviderPreset(
			ctx.stateManager,
			providerId as ApiProvider,
			model.id,
			model.info,
			providerInfo.mode,
		)
		await finalizeApiReqMsg()
	} catch (error) {
		const shouldRetry = await handleApiRequestError(ctx, {
			error,
			previousApiReqIndex,
			lastApiReqIndex,
			shouldCompact,
			model,
			providerId,
			metricsManager,
		})
		if (shouldRetry) {
			yield* attemptApiRequest(ctx, previousApiReqIndex, lastApiReqIndex, shouldCompact)
		}
		return
	}
}

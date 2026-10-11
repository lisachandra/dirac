import { EmptyRequest } from "@shared/proto/dirac/common"
import { State } from "@shared/proto/dirac/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import type { PresentationBatch } from "@/shared/PresentationOperation"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()
const subscriptionDeliveries = new WeakMap<StreamingResponseHandler<State>, Promise<void>>()

export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	try {
		const initialDelivery = enqueueSubscriptionDelivery(responseStream, async () => {
			await sendStateToSubscription(await controller.getStateToPostToWebview(), responseStream, 0)
		})
		activeStateSubscriptions.add(responseStream)
		await initialDelivery
	} catch (error) {
		Logger.error("Error publishing initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}

export async function sendStateUpdate(
	state: Partial<ExtensionState>,
	sequenceNumber: number,
	presentation?: PresentationBatch,
): Promise<void> {
	let stateJson: string
	let presentationJson: string | undefined
	try {
		stateJson = JSON.stringify(state)
		presentationJson = presentation ? JSON.stringify(presentation) : undefined
	} catch (error) {
		Logger.error(`[StatePublication] Failed to serialize sequence=${sequenceNumber}.`, error)
		throw error
	}

	const sizeBytes = Buffer.byteLength(stateJson, "utf8") + (presentationJson ? Buffer.byteLength(presentationJson, "utf8") : 0)
	recordStateSizeTelemetry(sizeBytes)

	const promises = Array.from(activeStateSubscriptions).map(async (responseStream) => {
		try {
			await enqueueSubscriptionDelivery(responseStream, () =>
				responseStream({ stateJson, presentationJson }, false, sequenceNumber),
			)
		} catch (error) {
			Logger.error(`[StatePublication] Delivery failed sequence=${sequenceNumber}.`, error)
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

function enqueueSubscriptionDelivery(
	responseStream: StreamingResponseHandler<State>,
	deliver: () => Promise<void>,
): Promise<void> {
	const previous = subscriptionDeliveries.get(responseStream) ?? Promise.resolve()
	const delivery = previous.then(deliver)
	subscriptionDeliveries.set(responseStream, delivery)
	return delivery
}

async function sendStateToSubscription(
	state: ExtensionState,
	responseStream: StreamingResponseHandler<State>,
	sequenceNumber: number,
): Promise<void> {
	const stateJson = JSON.stringify(state)
	recordStateSizeTelemetry(Buffer.byteLength(stateJson, "utf8"))
	await responseStream({ stateJson }, false, sequenceNumber)
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "dirac.StateService", "subscribeToState")
}

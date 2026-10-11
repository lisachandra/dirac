import { strict as assert } from "node:assert"
import * as modelPresets from "@core/models/modelProviderPresets"
import { describe, it } from "mocha"
import sinon from "sinon"
import { attemptApiRequest } from "../TaskApiRequestAttempt"
import * as requestBuilder from "../TaskRequestBuilder"
import * as requestOutcome from "../TaskRequestOutcome"
import { StreamingMetricsManager } from "../StreamingMetricsManager"
import * as steering from "../TaskSteering"

function failingStream(error: Error) {
	return {
		[Symbol.asyncIterator]() {
			return {
				next: sinon.stub().rejects(error),
			}
		},
	}
}

function emptyStream() {
	return {
		[Symbol.asyncIterator]() {
			return {
				next: sinon.stub().resolves({ done: true, value: undefined }),
			}
		},
	}
}

describe("TaskApiRequestAttempt request runtime", () => {
	it("reuses the exact request runtime and API handler across an automatic retry", async () => {
		const sandbox = sinon.createSandbox()
		try {
			const requestRuntime = {
				requestId: "request-1",
				workingConfiguration: { revision: 4, settings: { mode: "act" } },
				api: {
					getModel: () => ({ id: "request-model", info: {} }),
					createMessage: sandbox.stub(),
				},
			} as any
			requestRuntime.api.createMessage.onFirstCall().returns(failingStream(new Error("retry me")))
			requestRuntime.api.createMessage.onSecondCall().returns(emptyStream())

			const build = sandbox.stub(requestBuilder, "buildApiRequestParams").resolves({
				systemPrompt: "request prompt",
				toolSnapshot: { nativeTools: [{ name: "request-tool" }] },
				contextManagementMetadata: { truncatedConversationHistory: [{ role: "user", content: "request" }] },
				providerInfo: {
					providerId: "anthropic",
					model: { id: "request-model", info: {} },
					mode: "act",
				},
			} as any)
			sandbox.stub(requestOutcome, "handleApiRequestError").resolves(true)
			sandbox.stub(steering, "appendQueuedSteeringToNextApiRequest").resolves()
			sandbox.stub(modelPresets, "recordSuccessfulModelProviderPreset")
			sandbox.stub(StreamingMetricsManager.prototype, "updateApiReqMsgFromMetrics").resolves()

			const ctx = {
				requestRuntime,
				messageStateHandler: { updateDiracMessage: sandbox.stub().resolves() },
				taskState: {
					abort: false,
					isApiRequestActive: false,
					activeVoiceStreamId: undefined,
					status: undefined,
					isWaitingForFirstChunk: false,
				},
				steeringContext: {},
				apiConversationManager: {
					prepareProviderConversationDispatch: sandbox.stub().callsFake(async ({ systemPrompt, tools, truncatedMessages }) => ({
						messages: truncatedMessages,
						options: { systemPrompt, tools },
					})),
				},
				stateManager: {},
			} as any

			const chunks = []
			for await (const chunk of attemptApiRequest(ctx, 0, 0, false)) chunks.push(chunk)

			assert.deepEqual(chunks, [])
			sinon.assert.calledTwice(build)
			assert.equal(build.firstCall.args[1], requestRuntime)
			assert.equal(build.secondCall.args[1], requestRuntime)
			sinon.assert.calledTwice(requestRuntime.api.createMessage)
			assert.equal(requestRuntime.api.createMessage.firstCall.args[0], "request prompt")
			assert.equal(requestRuntime.api.createMessage.secondCall.args[0], "request prompt")
			assert.equal(requestRuntime.api.createMessage.firstCall.args[2][0].name, "request-tool")
			assert.equal(requestRuntime.api.createMessage.secondCall.args[2][0].name, "request-tool")
		} finally {
			sandbox.restore()
		}
	})
})

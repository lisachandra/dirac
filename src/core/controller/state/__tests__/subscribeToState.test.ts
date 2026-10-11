import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { EmptyRequest } from "@shared/proto/dirac/common"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { Controller } from "../../index"
import { getRequestRegistry } from "../../grpc-handler"
import { subscribeToState } from "../subscribeToState"

describe("subscribeToState", () => {
	it("hydrates only the new subscription before live broadcasts", async () => {
		const requestId = "ordered-state-subscription"
		const receivedSequences: number[] = []
		const state = { version: "test" } as ExtensionState
		const controller = {
			getStateToPostToWebview: async () => state,
		} as Controller

		try {
			await subscribeToState(
				controller,
				EmptyRequest.create(),
				async (_response, _isLast, sequenceNumber) => {
					receivedSequences.push(sequenceNumber ?? -1)
				},
				requestId,
			)

			assert.deepEqual(receivedSequences, [0])
		} finally {
			getRequestRegistry().cancelRequest(requestId)
		}
	})
})

import { DiracMessageType, TaskStatus } from "@shared/ExtensionMessage"
import type { PresentationBatch } from "@shared/PresentationOperation"
import { Text } from "ink"
import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest transforms this test with the classic JSX runtime.
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	stateSubscriber: undefined as undefined | ((update: { stateJson: string; presentationJson?: string }) => Promise<void>),
	cancelRequest: vi.fn(),
}))

vi.mock("@/core/controller/state/subscribeToState", () => ({
	subscribeToState: vi.fn(async (_controller, _request, subscriber) => {
		mocks.stateSubscriber = subscriber
	}),
}))

vi.mock("@/core/controller/grpc-handler", () => ({
	getRequestRegistry: () => ({ cancelRequest: mocks.cancelRequest }),
}))

import { TaskContextProvider, useTaskContext, useTaskState } from "./TaskContext"

let clearTaskContext: (() => void) | undefined

function Harness() {
	const state = useTaskState()
	clearTaskContext = useTaskContext().clearState
	const transcript = state.diracMessages?.map((message) =>
		message.content.type === DiracMessageType.MARKDOWN ? message.content.content : message.id,
	).join("|")
	return <Text>{`${transcript};${state.taskStatus ?? "no-status"};${state.activeVoiceStreamId ?? "closed"}`}</Text>
}

describe("TaskContextProvider", () => {
	beforeEach(() => {
		mocks.stateSubscriber = undefined
		mocks.cancelRequest.mockReset()
		clearTaskContext = undefined
	})

	it("publishes incremental create, patch, and append changes", async () => {
		const controller = { getStateToPostToWebview: vi.fn() }
		const app = render(
			<TaskContextProvider controller={controller}>
				<Harness />
			</TaskContextProvider>,
		)
		await vi.waitFor(() => expect(mocks.stateSubscriber).toBeDefined())
		const task = { id: "task", ts: 1, content: { type: DiracMessageType.MARKDOWN, content: "task", role: "user" } }
		await mocks.stateSubscriber?.({
			stateJson: JSON.stringify({
				diracMessages: [task],
				presentationSurfaceId: "task-1",
				presentationOffset: 0,
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		})
		await mocks.stateSubscriber?.({
			stateJson: "{}",
			presentationJson: JSON.stringify({
				surfaceId: "task-1",
				operations: [{
					offset: 1,
					type: "create",
					message: { id: "assistant", ts: 2, content: { type: DiracMessageType.MARKDOWN, content: "a", role: "assistant" } },
				}],
			} satisfies PresentationBatch),
		})
		await mocks.stateSubscriber?.({
			stateJson: "{}",
			presentationJson: JSON.stringify({
				surfaceId: "task-1",
				operations: [{ offset: 2, type: "append_markdown", id: "assistant", text: "b" }],
			} satisfies PresentationBatch),
		})
		await mocks.stateSubscriber?.({
			stateJson: "{}",
			presentationJson: JSON.stringify({
				surfaceId: "task-1",
				operations: [{ offset: 3, type: "patch_markdown", id: "assistant", patch: { role: "assistant" } }],
			} satisfies PresentationBatch),
		})

		await vi.waitFor(() => expect(app.lastFrame()).toContain("task|ab"))
		app.unmount()
	})

	it("clears stale streaming and presentation state", async () => {
		const app = render(
			<TaskContextProvider controller={{}}>
				<Harness />
			</TaskContextProvider>,
		)
		await vi.waitFor(() => expect(mocks.stateSubscriber).toBeDefined())
		await mocks.stateSubscriber?.({
			stateJson: JSON.stringify({
				diracMessages: [{
					id: "stream",
					ts: 1,
					content: { type: DiracMessageType.MARKDOWN, content: "streaming", role: "assistant" },
				}],
				activeVoiceStreamId: "stream",
			}),
		})
		await vi.waitFor(() => expect(app.lastFrame()).toContain("streaming;no-status;stream"))
		await mocks.stateSubscriber?.({ stateJson: "{}" })
		await vi.waitFor(() => expect(app.lastFrame()).toContain("streaming;no-status;closed"))
		clearTaskContext?.()
		await vi.waitFor(() => expect(app.lastFrame()).toContain(";no-status;closed"))
		app.unmount()
	})
})

import { DiracMessageType, SteeringTranscriptStatus } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
import { TaskMessageBridge } from "./taskMessageBridge.js"
import { AcpSessionStatus } from "./public-types.js"

function createBridge() {
	const emitSessionUpdate = vi.fn().mockResolvedValue(undefined)
	const emitSteeringStatus = vi.fn()
	const bridge = new TaskMessageBridge({
		getSession: () => ({}) as any,
		getController: () => undefined,
		requestPermission: vi.fn(),
		emitSessionUpdate,
		getClientCapabilities: () => ({}),
		requestElicitation: vi.fn(),
		persistPermissionRule: vi.fn(),
		emitSteeringStatus,
	})
	return { bridge, emitSessionUpdate, emitSteeringStatus }
}

function steeringMessage(status: SteeringTranscriptStatus) {
	return {
		id: "transcript-1",
		ts: 1,
		content: {
			type: DiracMessageType.MARKDOWN,
			content: "Keep going",
			role: "user" as const,
			steering: { status },
		},
	}
}

const sessionState = {
	sessionId: "session-1",
	status: AcpSessionStatus.Processing,
	pendingToolCalls: new Map(),
}

describe("TaskMessageBridge steering transcripts", () => {
	it("does not emit user steering as assistant output", async () => {
		const { bridge, emitSessionUpdate } = createBridge()

		await (bridge as any).processMessageWithDelta(
			"session-1",
			sessionState,
			steeringMessage(SteeringTranscriptStatus.QUEUED),
		)

		expect(emitSessionUpdate).not.toHaveBeenCalled()
	})

	it("reports sent steering once without emitting assistant output", async () => {
		const { bridge, emitSessionUpdate, emitSteeringStatus } = createBridge()
		const message = steeringMessage(SteeringTranscriptStatus.SENT)

		await (bridge as any).processMessageWithDelta("session-1", sessionState, message)
		await (bridge as any).processMessageWithDelta("session-1", sessionState, message)

		expect(emitSessionUpdate).not.toHaveBeenCalled()
		expect(emitSteeringStatus).toHaveBeenCalledOnce()
		expect(emitSteeringStatus).toHaveBeenCalledWith("session-1", "transcript-1", "sent")
	})
})

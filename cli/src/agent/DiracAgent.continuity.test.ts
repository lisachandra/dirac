import { TaskStatus } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
	let activePromptResolver: ((response: { stopReason: string }) => void) | undefined
	const controllers: MockController[] = []

	let resolveSubmittedResponses = true
	let resumeParksCancelled = false
	const conversationHistory = ["remember: established context"]

	const task = {
		taskId: "session-task",
		conversationHistory,
		taskState: {
			lastWaitingCardId: undefined as string | undefined,
			didAttemptCompletion: true,
			status: "awaiting_user_input",
			abort: false,
		},
		messageStateHandler: {
			getDiracMessages: vi.fn(() => []),
			on: vi.fn(),
			off: vi.fn(),
		},
		submitCardResponse: vi.fn(async () => {
			if (resolveSubmittedResponses) activePromptResolver?.({ stopReason: "end_turn" })
		}),
		rebuildApiHandler: vi.fn(),
		applyRuntimeModeChange: vi.fn(),
		createApiHandlerForRuntime: vi.fn(() => ({ getModel: () => ({ id: "act-model", info: {} }) })),
		setApiHandler: vi.fn(),
		canAcceptSteeringMessage: vi.fn(() => false),
	}

	class MockController {
		task: typeof task | undefined
		taskRunPromise: Promise<void> | undefined
		getStateToPostToWebview = vi.fn(async () => ({ mode: "act" }))
		onTaskReplaced = vi.fn(() => () => undefined)
		dispose = vi.fn()
		initTask = vi.fn(async () => {
			this.task = task
			return task.taskId
		})
		reinitExistingTaskFromId = vi.fn(async () => {
			this.task = task
			task.taskState.didAttemptCompletion = true
			// Reinitialize parks the resumed task in resumeTaskFromHistory() waiting
			// for the follow-up prompt. An interrupted transcript (e.g. daemon
			// force-cancel) parks with status CANCELLED instead of COMPLETED.
			task.taskState.status = resumeParksCancelled ? TaskStatus.CANCELLED : TaskStatus.COMPLETED
		})
		cancelTask = vi.fn(async () => {
			this.task = task
			task.taskState.lastWaitingCardId = undefined
			task.taskState.didAttemptCompletion = false
			task.taskState.status = TaskStatus.CANCELLED
		})

		constructor() {
			controllers.push(this)
		}
	}

	class MockTaskMessageBridge {
		clearPromptState = vi.fn()
		promptResponse = vi.fn((stopReason: string) => ({ stopReason }))
		cancelInFlightToolCalls = vi.fn(async () => undefined)
		invalidatePendingInteractions = vi.fn()
		waitForMessageWork = vi.fn(async () => undefined)
		subscribeToTaskMessages = vi.fn(
			(
				_controller: unknown,
				_sessionId: string,
				_sessionState: unknown,
				resolvePrompt: (response: { stopReason: string }) => void,
			) => {
				activePromptResolver = resolvePrompt
			},
		)
		replayTaskMessages = vi.fn(async () => {
			activePromptResolver?.({ stopReason: "end_turn" })
		})
	}

	return {
		controllers,
		task,
		MockController,
		MockTaskMessageBridge,
		setResolveSubmittedResponses(value: boolean) {
			resolveSubmittedResponses = value
		},
		setResumeParksCancelled(value: boolean) {
			resumeParksCancelled = value
		},
		reset() {
			activePromptResolver = undefined
			controllers.splice(0)
			task.taskState.lastWaitingCardId = undefined
			task.taskState.didAttemptCompletion = true
			task.taskState.status = "awaiting_user_input"
			task.messageStateHandler.getDiracMessages.mockClear()
			task.submitCardResponse.mockClear()
			task.rebuildApiHandler.mockClear()
			task.applyRuntimeModeChange.mockClear()
			task.createApiHandlerForRuntime.mockClear()
			task.setApiHandler.mockClear()
			sessionOverrideCache = {}
			resolveSubmittedResponses = true
			resumeParksCancelled = false
		},
	}
})

let sessionOverrideCache: Record<string, unknown> = {}

const stateManager: any = {
	getGlobalSettingsKey: vi.fn((key: string) => {
		if (key === "mode") return "act"
		if (key === "actModeApiProvider") return "anthropic"
		return undefined
	}),
	getSystemDefaultSettingsKey: vi.fn((key: string) => {
		if (key === "mode") return "act"
		if (key === "actModeApiProvider" || key === "planModeApiProvider") return "anthropic"
		return undefined
	}),
	getSessionOverrideCache: vi.fn(() => sessionOverrideCache),
	setSessionOverrideCache: vi.fn((overrides: Record<string, unknown>) => {
		sessionOverrideCache = overrides
	}),
	getApiConfiguration: vi.fn(() => ({})),
	getGlobalStateKey: vi.fn(() => []),
	flushPendingState: vi.fn(async () => undefined),
}

vi.mock("@/core/controller", () => ({ Controller: mocks.MockController }))
vi.mock("@/core/storage/disk", () => ({ setRuntimeHooksDir: vi.fn() }))
vi.mock("@/core/storage/StateManager", () => ({ StateManager: { get: vi.fn(() => stateManager) } }))
vi.mock("./taskMessageBridge.js", () => ({ TaskMessageBridge: mocks.MockTaskMessageBridge }))

const { DiracAgent } = await import("./DiracAgent.js")

describe("DiracAgent ACP conversation continuity", () => {
	afterEach(() => {
		mocks.reset()
		vi.clearAllMocks()
	})

	it("continues a completed turn on the existing task for the same session", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "execute ls" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})
		expect(controller.initTask).toHaveBeenCalledTimes(1)
		const originalTask = controller.task

		mocks.task.taskState.status = TaskStatus.COMPLETED
		setTimeout(() => {
			mocks.task.taskState.status = TaskStatus.AWAITING_USER_INPUT
		}, 20)

		await expect(
			agent.prompt({ sessionId, prompt: [{ type: "text", text: "what was my last message?" }] } as any),
		).resolves.toEqual({ stopReason: "end_turn" })

		expect(controller.task).toBe(originalTask)
		expect(controller.initTask).toHaveBeenCalledTimes(1)
		expect(mocks.task.submitCardResponse).toHaveBeenCalledWith(
			"",
			DiracAskResponse.MESSAGE,
			"what was my last message?",
			[],
			[],
		)
		expect(mocks.task.taskState.status).toBe(TaskStatus.AWAITING_USER_INPUT)
	})

	it("starts a new task for the first prompt after loading completed history", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]
		const session = (agent as any).sessions.get(sessionId)
		session.isLoadedFromHistory = true
		session.loadedTaskId = "completed-task"

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "start a follow-up" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})

		expect(controller.reinitExistingTaskFromId).toHaveBeenCalledWith("completed-task", expect.any(Object))
		expect(mocks.task.submitCardResponse).toHaveBeenCalledWith(
			"",
			DiracAskResponse.MESSAGE,
			"start a follow-up",
			[],
			[],
		)
	})

	it("resumes the reinitialized task after cancellation without a historical resume card", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "remember this context" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})
		const backingTaskId = controller.task!.taskId
		const initCallsBeforeCancellation = controller.initTask.mock.calls.length

		mocks.setResolveSubmittedResponses(false)
		const activeTurn = agent.prompt({ sessionId, prompt: [{ type: "text", text: "begin active work" }] } as any)
		await vi.waitFor(() =>
			expect(mocks.task.submitCardResponse).toHaveBeenCalledWith(
				"",
				DiracAskResponse.MESSAGE,
				"begin active work",
				[],
				[],
			),
		)

		await agent.cancel({ sessionId } as any)
		await expect(activeTurn).resolves.toEqual({ stopReason: "cancelled" })
		expect(controller.cancelTask).toHaveBeenCalledOnce()
		expect((agent as any).sessions.get(sessionId).awaitingCancelledTaskResume).toBe(true)

		mocks.setResolveSubmittedResponses(true)
		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "continue using the context" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})

		expect(controller.task?.taskId).toBe(backingTaskId)
		expect(controller.task?.conversationHistory).toEqual(["remember: established context"])
		expect(controller.initTask).toHaveBeenCalledTimes(initCallsBeforeCancellation)
		expect(mocks.task.submitCardResponse).toHaveBeenLastCalledWith(
			"",
			DiracAskResponse.MESSAGE,
			"continue using the context",
			[],
			[],
		)
		expect((agent as any).sessions.get(sessionId).awaitingCancelledTaskResume).toBe(false)
	})

	it("handles cancellation timeout by aborting the reinitialized task and allowing prompt continuation", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]

		await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "task 1" }] } as any)).resolves.toEqual({
			stopReason: "end_turn",
		})

		vi.useFakeTimers()
		try {
			// Make cancelTask take indefinitely (simulate timeout)
			controller.cancelTask = vi.fn(() => new Promise(() => {}))

			mocks.setResolveSubmittedResponses(false)
			const activeTurn = agent.prompt({ sessionId, prompt: [{ type: "text", text: "active work" }] } as any)

			const cancelPromise = agent.cancel({ sessionId } as any)
			await vi.advanceTimersByTimeAsync(11000)
			await cancelPromise

			expect(mocks.task.taskState.abort).toBe(true)
			expect((agent as any).sessions.get(sessionId).awaitingCancelledTaskResume).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})


	it("resumes a loaded session whose transcript parked as CANCELLED (interrupted turn)", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "act", availableModes: [] }))
			; (agent as any).sendAvailableCommands = vi.fn(async () => undefined)
			; (agent as any).setSessionTitleFromFirstExchange = vi.fn(async () => undefined)

		// Mock a loaded session whose reinitialized task parks in CANCELLED because
		// the transcript ended on an interrupted turn (e.g. daemon force-cancel).
		mocks.setResumeParksCancelled(true)
		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const session = (agent as any).sessions.get(sessionId)
		session.isLoadedFromHistory = true
		session.loadedTaskId = "interrupted-task"
		const controller = mocks.controllers[0]

		await expect(
			agent.prompt({ sessionId, prompt: [{ type: "text", text: "continue where I left off" }] } as any),
		).resolves.toEqual({ stopReason: "end_turn" })

		expect(controller.reinitExistingTaskFromId).toHaveBeenCalledWith("interrupted-task", expect.any(Object))
		expect(mocks.task.submitCardResponse).toHaveBeenCalledWith(
			"",
			DiracAskResponse.MESSAGE,
			"continue where I left off",
			[],
			[],
		)
	})

	it("installs Act overrides immediately when the active prompt changes mode", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
			; (agent as any).providerConfiguration.assertProviderEnabled = vi.fn()
			; (agent as any).sessionConfig.getSessionConfigOptions = vi.fn(async () => [])
			; (agent as any).sessionConfig.getSessionModeState = vi.fn(() => ({ currentModeId: "plan", availableModes: [] }))

		stateManager.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (Object.hasOwn(sessionOverrideCache, key)) {
				return sessionOverrideCache[key] as "act" | "anthropic" | undefined
			}
			if (key === "mode") return "plan"
			if (key === "planModeApiProvider" || key === "actModeApiProvider") return "anthropic"
			return undefined
		})
		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const session = (agent as any).sessions.get(sessionId)
		const controller = mocks.controllers[0]
		controller.task = mocks.task
			; (agent as any).activePromptSessionId = sessionId
		sessionOverrideCache = { mode: "plan", planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" }

		const nextOverrides = {
			...(agent as any).acpSessionOverrides.get(sessionId),
			mode: "act",
			actModeApiProvider: "anthropic",
		}
			; (agent as any).replaceSessionRuntimeConfig(session, nextOverrides, "act")

		expect(sessionOverrideCache.mode).toBe("act")
		expect(stateManager.getGlobalSettingsKey("mode")).toBe("act")
		expect(mocks.task.setApiHandler).toHaveBeenCalledOnce()
	})

	it("forces cleanup during shutdown while preserving close-session guards", async () => {
		const agent = new DiracAgent({ cwd: "/tmp/workspace" })
			; (agent as any).ctx = { extensionContext: {}, DATA_DIR: "/tmp/dirac-test-data" }
		const { sessionId } = await agent.newSession({ cwd: "/tmp/workspace", mcpServers: [] } as any)
		const controller = mocks.controllers[0]
			; (agent as any).configuringSessions.add(sessionId)

		await expect(agent.closeSession({ sessionId } as any)).rejects.toThrow("applying a runtime configuration change")
		await expect(agent.shutdown()).resolves.toBeUndefined()
		expect(controller.dispose).toHaveBeenCalledOnce()
		expect((agent as any).sessions.has(sessionId)).toBe(false)
	})
})

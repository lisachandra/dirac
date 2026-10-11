import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import type { Task } from "@core/task"
import type { TaskRunOutcome } from "@core/task/TaskRunOutcome"
import type { CardParams, ICardHandle } from "@core/task/tools/interfaces/IToolEnvironment"
import { CardStatus, DiracMessageType, type DiracMessage } from "@shared/ExtensionMessage"
import type { GoalRecord } from "@shared/goal"
import { ResponseOperation } from "@shared/responseTool"
import { DiracAskResponse } from "@shared/WebviewMessage"
import type { GoalRecordUpdate, GoalStore } from "../GoalStore"
import { GoalTaskHost, GoalTerminalGuardError, type GoalChildTaskFactoryInput } from "../GoalTaskHost"

interface Deferred<T> {
	promise: Promise<T>
	resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((settle) => {
		resolve = settle
	})
	return { promise, resolve }
}

class MemoryGoalStore {
	private now = 100

	private nextUpdateFailure?: Error
	constructor(private record: GoalRecord, private readonly clockStepMs = 1) { }

	failNextUpdate(error: Error): void {
		this.nextUpdateFailure = error
	}

	async read(goalId: string): Promise<GoalRecord> {
		assert.equal(goalId, this.record.id)
		return structuredClone(this.record)
	}

	async update(goalId: string, update: GoalRecordUpdate): Promise<GoalRecord> {
		assert.equal(goalId, this.record.id)
		if (this.nextUpdateFailure) {
			const error = this.nextUpdateFailure
			this.nextUpdateFailure = undefined
			throw error
		}
		this.now += this.clockStepMs
		await update(this.record, this.now)
		this.record.updatedAt = this.now
		return structuredClone(this.record)
	}
}

class ControlledTask {
	readonly outcome = deferred<TaskRunOutcome>()
	readonly messages: DiracMessage[] = []
	readonly apiConversation: any[] = []
	readonly steering: string[] = []
	private settled = false

	readonly messageStateHandler = {
		getDiracMessages: () => this.messages,
		getApiConversationHistory: () => this.apiConversation,
	}

	startTask(): Promise<TaskRunOutcome> {
		return this.outcome.promise
	}

	async enqueueSteeringMessage(message: string): Promise<void> {
		this.steering.push(message)
	}

	async abortTask(intent: { kind: "cancelled" | "interrupted"; reason?: string }): Promise<void> {
		if (this.settled) return
		this.settled = true
		if (intent.kind === "cancelled") {
			this.outcome.resolve({ kind: "cancelled", reason: intent.reason, cancelledAt: Date.now() })
			return
		}
		this.outcome.resolve({
			kind: "interrupted",
			reason: intent.reason ?? "Interrupted",
			interruptedAt: Date.now(),
		})
	}

	complete(response: string): void {
		if (this.settled) return
		this.settled = true
		this.outcome.resolve({ kind: "completed", response, completedAt: Date.now() })
	}
}

function goalRecord(): GoalRecord {
	return {
		version: 1,
		id: "goal",
		conversationUlid: "conversation",
		status: "working",
		objective: { markdown: "Ship it", revision: 1, updatedAt: 100 },
		createdAt: 100,
		updatedAt: 100,
		lastActivatedAt: 100,
		activeDurationMs: 0,
		wakeSequence: 0,
		eventSequence: 0,
		events: [],
		children: [],
		accountingSources: {},
		accounting: {},
	}
}

function createHarness(heartbeatMs = 5, clockStepMs = 1) {
	const store = new MemoryGoalStore(goalRecord(), clockStepMs)
	const tasks = new Map<string, ControlledTask>()
	const taskInputs = new Map<string, GoalChildTaskFactoryInput>()
	const createTask = async (input: GoalChildTaskFactoryInput): Promise<Task> => {
		const task = new ControlledTask()
		tasks.set(input.id, task)
		taskInputs.set(input.id, input)
		return task as unknown as Task
	}
	const host = new GoalTaskHost("goal", store as unknown as GoalStore, createTask, heartbeatMs)
	return { host, store, tasks, taskInputs }
}

function responseMessage(
	text: string,
	operation: ResponseOperation = ResponseOperation.PROGRESS,
	options?: string[],
): DiracMessage {
	return {
		id: `message-${text.length}`,
		ts: Date.now(),
		content: {
			type: DiracMessageType.CARD,
			card: {
				id: `card-${text.length}`,
				header: "Goal Task Response",
				toolName: "goal_child_response",
				status: CardStatus.SUCCESS,
				renderType: "markdown",
				body: text,
				rawInput: { operation, text, ...(options ? { options } : {}) },
			},
		},
	}
}

function interactionCard(params: CardParams): ICardHandle {
	return {
		id: "interaction-card",
		header: params.header,
		icon: params.icon,
		renderType: params.renderType ?? "text",
		body: params.body ?? "",
		rawInput: params.rawInput,
		rawOutput: params.rawOutput,
		locations: params.locations,
		requireApproval: params.requireApproval,
		requireFeedback: params.requireFeedback,
		feedbackPlaceholder: params.feedbackPlaceholder,
		actions: params.actions,
		maxHeight: params.maxHeight,
		cleanupStrategy: params.cleanupStrategy,
		collapsed: params.collapsed ?? false,
		status: CardStatus.WAITING_FOR_INPUT,
		update: async () => undefined,
		appendBody: async () => undefined,
		waitForInteraction: async () => ({ action: "unused", response: DiracAskResponse.MESSAGE }),
		finalize: async () => undefined,
	}
}

describe("GoalTaskHost", () => {
	it("runs children concurrently with unique same-millisecond timestamp IDs and distinct conversation ULIDs", async () => {
		const { host, taskInputs } = createHarness(5, 0)
		const [first, second] = await Promise.all([
			host.startTask({ taskTitle: "First", prompt: "Do first" }),
			host.startTask({ taskTitle: "Second", prompt: "Do second" }),
		])

		assert.match(first.id, /^\d+$/)
		assert.match(second.id, /^\d+$/)
		assert.notEqual(first.id, second.id)
		const firstInput = taskInputs.get(first.id)
		const secondInput = taskInputs.get(second.id)
		assert.ok(firstInput)
		assert.ok(secondInput)
		assert.match(firstInput.conversationUlid, /^[0-9A-HJKMNP-TV-Z]{26}$/)
		assert.match(secondInput.conversationUlid, /^[0-9A-HJKMNP-TV-Z]{26}$/)
		assert.notEqual(firstInput.conversationUlid, first.id)
		assert.notEqual(secondInput.conversationUlid, second.id)
		assert.notEqual(firstInput.conversationUlid, secondInput.conversationUlid)

		await assert.rejects(
			host.commitTerminalAttempt(async () => ({ committed: true })),
			(error: unknown) =>
				error instanceof GoalTerminalGuardError &&
				error.message.includes(first.id) &&
				error.message.includes(second.id),
		)

		const firstPage = await host.listTasks({ status: ["running"], limit: 1 })
		assert.deepEqual(firstPage.tasks.map((task) => task.id), [first.id])
		await host.cancelTask(first.id)
		const secondPage = await host.listTasks({ status: ["running"], cursor: firstPage.nextCursor, limit: 1 })
		assert.deepEqual(secondPage.tasks.map((task) => task.id), [second.id])
		await host.cancelTask(second.id)
		assert.deepEqual(await host.commitTerminalAttempt(async () => ({ committed: true })), { committed: true })
	})

	it("preserves the last real activity timestamp when a child becomes terminal", async () => {
		const { host, store } = createHarness()
		const child = await host.startTask({ taskTitle: "Timed", prompt: "Do timed work" })
		await host.recordActivity(child.id)
		const active = (await store.read("goal")).children[0]

		await host.cancelTask(child.id, "No longer needed")

		const terminal = (await store.read("goal")).children[0]
		assert.equal(terminal.status, "cancelled")
		assert.equal(terminal.lastActivityAt, active.lastActivityAt)
		assert.ok(terminal.endedAt !== undefined)
		assert.ok(terminal.endedAt > terminal.lastActivityAt)
		const [summary] = (await host.listTasks({ status: ["cancelled"] })).tasks
		assert.equal(summary.idleDurationMs, terminal.endedAt - terminal.lastActivityAt)
	})

	it("delivers complete response payloads and acknowledges them only after coordinator persistence", async () => {
		const { host, store, tasks } = createHarness(1)
		const first = await host.startTask({ taskTitle: "First", prompt: "Do first" })
		const second = await host.startTask({ taskTitle: "Second", prompt: "Do second" })
		const question = "Which release path?"
		const options = ["Canary", "Immediate"]
		const completePayload = `complete-${"x".repeat(4_000)}`
		tasks.get(first.id)!.messages.push(responseMessage(question, ResponseOperation.QUESTION, options))
		await host.recordResponse(first.id, { operation: ResponseOperation.QUESTION, text: question, options })
		tasks.get(second.id)!.messages.push(responseMessage(completePayload, ResponseOperation.COMPLETE))
		await host.recordResponse(second.id, { operation: ResponseOperation.COMPLETE, text: completePayload })

		const wake = await host.waitForEvents()
		assert.ok(wake.indexOf(question) < wake.indexOf(completePayload))
		assert.ok(wake.includes(`Response payload: ${JSON.stringify({ operation: ResponseOperation.QUESTION, text: question, options })}`))
		assert.ok(wake.includes(completePayload))

		const beforePersistence = await store.read("goal")
		assert.equal(beforePersistence.events.length, 2)
		assert.equal(beforePersistence.children.find((child) => child.id === first.id)?.deliveredResponseCursor, 0)
		assert.equal(beforePersistence.children.find((child) => child.id === second.id)?.deliveredResponseCursor, 0)

		await host.acknowledgePersistedWake()
		const persisted = await store.read("goal")
		assert.deepEqual(persisted.events, [])
		assert.equal(persisted.children.find((child) => child.id === first.id)?.deliveredResponseCursor, 1)
		assert.equal(persisted.children.find((child) => child.id === second.id)?.deliveredResponseCursor, 1)

		const heartbeat = await host.waitForEvents()
		assert.match(heartbeat, /Reason: heartbeat/)
		await Promise.all([host.cancelTask(first.id), host.cancelTask(second.id)])
	})

	it("replays a claimed wake when coordinator conversation persistence rolls back", async () => {
		const { host, store, tasks } = createHarness()
		const child = await host.startTask({ taskTitle: "Replay", prompt: "Report once" })
		tasks.get(child.id)!.messages.push(responseMessage("still unread"))
		await host.recordResponse(child.id, { operation: ResponseOperation.PROGRESS, text: "still unread" })

		assert.match(await host.waitForEvents(), /still unread/)
		await host.rollbackUnpersistedWake()
		const unread = await store.read("goal")
		assert.equal(unread.events.length, 1)
		assert.equal(unread.children[0].deliveredResponseCursor, 0)

		assert.match(await host.waitForEvents(), /still unread/)
		await host.acknowledgePersistedWake()
		assert.equal((await store.read("goal")).children[0].deliveredResponseCursor, 1)
		await host.cancelTask(child.id)
	})

	it("keeps a durably persisted claim retryable when cursor settlement fails", async () => {
		const { host, store, tasks } = createHarness()
		const child = await host.startTask({ taskTitle: "Retry settlement", prompt: "Report once" })
		tasks.get(child.id)!.messages.push(responseMessage("persisted wake"))
		await host.recordResponse(child.id, { operation: ResponseOperation.PROGRESS, text: "persisted wake" })
		await host.waitForEvents()

		store.failNextUpdate(new Error("settlement write failed"))
		await assert.rejects(host.acknowledgePersistedWake(), /settlement write failed/)
		await host.rollbackUnpersistedWake()
		const unsettled = await store.read("goal")
		assert.equal(unsettled.events.length, 1)
		assert.equal(unsettled.children[0].deliveredResponseCursor, 0)
		await assert.rejects(host.waitForEvents(), /awaiting coordinator conversation persistence/)

		await host.acknowledgePersistedWake()
		const settled = await store.read("goal")
		assert.deepEqual(settled.events, [])
		assert.equal(settled.children[0].deliveredResponseCursor, 1)
		await host.cancelTask(child.id)
	})

	it("resolves a child interaction once and invalidates unresolved interactions on shutdown", async () => {
		const { host, store } = createHarness()
		const child = await host.startTask({ taskTitle: "Interactive", prompt: "Ask first" })
		const params: CardParams = { header: "Choose", body: "Need input", requireFeedback: true }
		const firstInteraction = host.waitForInteraction(child.id, params, interactionCard(params))
		const pending = (await store.read("goal")).children[0].pendingInteraction
		assert.ok(pending)
		await host.resolveTaskInteraction({
			taskId: child.id,
			interactionId: pending.id,
			resolution: "answer",
			answer: "Use the safe option",
		})
		assert.deepEqual(await firstInteraction, {
			action: DiracAskResponse.MESSAGE,
			response: DiracAskResponse.MESSAGE,
			text: "Use the safe option",
		})
		await assert.rejects(
			host.resolveTaskInteraction({
				taskId: child.id,
				interactionId: pending.id,
				resolution: "answer",
				answer: "Again",
			}),
			/stale/,
		)

		const passthroughInteraction = host.waitForInteraction(child.id, params, interactionCard(params))
		await new Promise((resolve) => setImmediate(resolve))
		const passthroughPending = (await store.read("goal")).children[0].pendingInteraction
		assert.ok(passthroughPending)
		await host.resolveTaskInteraction({
			taskId: child.id,
			interactionId: passthroughPending.id,
			resolution: "passthrough",
			passthroughResult: { action: DiracAskResponse.REJECT, response: DiracAskResponse.REJECT },
		})
		assert.deepEqual(await passthroughInteraction, {
			action: DiracAskResponse.REJECT,
			response: DiracAskResponse.REJECT,
		})

		const unresolvedInteraction = host.waitForInteraction(child.id, params, interactionCard(params))
		await new Promise((resolve) => setImmediate(resolve))
		const rejectedInteraction = assert.rejects(unresolvedInteraction, /Goal paused/)
		await host.shutdown("interrupted", "Goal paused")
		await rejectedInteraction
		const interrupted = (await store.read("goal")).children[0]
		assert.equal(interrupted.status, "interrupted")
		assert.equal(interrupted.pendingInteraction, undefined)
	})
})

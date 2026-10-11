import { strict as assert } from "node:assert"
import { CardStatus } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { expectLoggerErrors } from "@/test/loggerGuard"
import { LocalConversationCompaction } from "../LocalConversationCompaction"
import { TaskState } from "../TaskState"

function createMocks() {
	const taskState = new TaskState()
	const selection = {
		provider: "anthropic",
		modelId: "claude-sonnet-4-20250514",
	}
	const card = {
		update: sinon.stub().resolves(),
		appendBody: sinon.stub().resolves(),
		finalize: sinon.stub().resolves(),
		waitForInteraction: sinon.stub().resolves({ action: DiracAskResponse.APPROVE, response: DiracAskResponse.APPROVE }),
	}
	let providerState: any = {
		checkpoint: { providerId: "active", modelId: "model", input: [] },
	}
	const messageStateHandler = {
		getApiConversationHistory: sinon.stub().returns([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "second" },
			{ role: "user", content: "third" },
		]),
		getDiracMessages: sinon.stub().returns([]),
		getApiConversationProviderState: sinon.stub().callsFake(() => providerState),
		overwriteApiConversationProviderState: sinon.stub().callsFake(async (state: any) => {
			providerState = state
		}),
		saveDiracMessagesAndUpdateHistory: sinon.stub().resolves(),
	}
	const onContextCompacted = sinon.stub()
	const dependencies = {
		taskId: "task-1",
		ulid: "ulid-1",
		taskState,
		messageStateHandler,
		contextManager: {
			getNextTruncationRange: sinon.stub().returns([0, 1]),
		},
		getWorkingConfiguration: sinon.stub().returns({
			settings: {
				utilityModelEnabled: true, utilityModelUseCondense: true, utilityModelUseNewTask: true,
				utilityModelSelection: selection, hooksEnabled: false, mode: "act",
			},
			apiConfiguration: { apiKey: "test-key" },
		}),
		taskMessenger: { createCard: sinon.stub().resolves(card) },
		getApi: sinon.stub().returns({}),
		postStateToWebview: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		onContextCompacted,
	}
	const compaction = new LocalConversationCompaction(dependencies as any)
	return {
		card,
		compaction,
		dependencies,
		messageStateHandler,
		onContextCompacted,
		taskState,
		getProviderState: () => providerState,
	}
}

describe("LocalConversationCompaction", () => {
	afterEach(() => sinon.restore())

	it("silently declines when no Utility model is configured", async () => {
		const { card, compaction, dependencies } = createMocks()
		dependencies.getWorkingConfiguration.returns({ ...dependencies.getWorkingConfiguration(), settings: { ...dependencies.getWorkingConfiguration().settings, utilityModelEnabled: false, utilityModelUseCondense: false } })

		assert.equal(compaction.isAvailable(), false)
		const outcome = await compaction.run({ source: "automatic" })

		assert.equal(outcome.status, "unavailable")
		assert.equal(dependencies.taskMessenger.createCard.callCount, 0)
		assert.equal(card.finalize.callCount, 0)
	})

	it("returns the committed continuation when success-card presentation fails", async () => {
		expectLoggerErrors()
		const { card, compaction, onContextCompacted, taskState } = createMocks()
		sinon.stub(compaction as any, "generateSummary").resolves("completed summary")
		card.update.rejects(new Error("card update failed"))

		const outcome = await compaction.run({
			source: "automatic",
			triggerApiRequestIndex: 7,
		})

		if (outcome.status !== "completed") assert.fail(`unexpected status: ${outcome.status}`)
		assert.match(outcome.continuation, /completed summary/)
		assert.deepEqual(taskState.conversationHistoryDeletedRange, [0, 1])
		assert.equal(taskState.lastAutoCondenseTriggerIndex, 7)
		assert.equal(onContextCompacted.callCount, 1)
	})

	it("returns the committed continuation when the compaction observer fails", async () => {
		expectLoggerErrors()
		const { card, compaction, onContextCompacted, taskState } = createMocks()
		sinon.stub(compaction as any, "generateSummary").resolves("completed summary")
		onContextCompacted.throws(new Error("observer failed"))

		const outcome = await compaction.run({ source: "user" })

		if (outcome.status !== "completed") assert.fail(`unexpected status: ${outcome.status}`)
		assert.match(outcome.continuation, /completed summary/)
		assert.equal(card.waitForInteraction.callCount, 1)
		assert.deepEqual(taskState.conversationHistoryDeletedRange, [0, 1])
		assert.ok(card.finalize.calledWith(CardStatus.SUCCESS))
	})

	it("rolls back task and provider state when history persistence fails", async () => {
		const { compaction, messageStateHandler, taskState, getProviderState } = createMocks()
		const previousPending = {
			conversationHistoryDeletedRange: [0, 0] as [number, number],
			previousConversationHistoryDeletedRange: undefined,
		}
		taskState.conversationHistoryDeletedRange = [0, 0]
		taskState.skipNextAutoCondenseCheck = false
		taskState.pendingApiConversationCompaction = previousPending
		taskState.lastAutoCondenseTriggerIndex = 3
		const previousProviderState = getProviderState()
		messageStateHandler.saveDiracMessagesAndUpdateHistory.onFirstCall().rejects(new Error("history save failed"))
		messageStateHandler.saveDiracMessagesAndUpdateHistory.onSecondCall().resolves()

		await assert.rejects((compaction as any).applyCompaction([0, 1], 7), /history save failed/)

		assert.deepEqual(taskState.conversationHistoryDeletedRange, [0, 0])
		assert.equal(taskState.skipNextAutoCondenseCheck, false)
		assert.equal(taskState.pendingApiConversationCompaction, previousPending)
		assert.equal(taskState.lastAutoCondenseTriggerIndex, 3)
		assert.equal(getProviderState(), previousProviderState)
	})

	it("does not commit when cancellation arrives after the PreCompact phase", async () => {
		const { compaction, messageStateHandler, taskState } = createMocks()
		sinon.stub(compaction as any, "generateSummary").resolves("completed summary")
		sinon.stub(compaction as any, "runPreCompactHook").callsFake(async () => {
			taskState.abort = true
			return undefined
		})

		const outcome = await compaction.run({ source: "automatic" })

		assert.equal(outcome.status, "cancelled")
		assert.equal(messageStateHandler.overwriteApiConversationProviderState.callCount, 0)
		assert.equal(taskState.conversationHistoryDeletedRange, undefined)
	})
	it("asks before a user condensation and leaves the conversation untouched when declined", async () => {
		const { card, compaction, dependencies, taskState } = createMocks()
		card.waitForInteraction.resolves({ action: DiracAskResponse.REJECT, response: DiracAskResponse.REJECT })
		const generateSummary = sinon.stub(compaction as any, "generateSummary").resolves("completed summary")

		const outcome = await compaction.run({ source: "user" })

		assert.equal(outcome.status, "cancelled")
		const approval = dependencies.taskMessenger.createCard.firstCall.args[0]
		assert.equal(approval.header, "Condense Conversation")
		assert.equal(approval.requireApproval, true)
		assert.equal(generateSummary.callCount, 0)
		assert.ok(card.finalize.calledWith(CardStatus.CANCELLED))
		assert.equal(taskState.conversationHistoryDeletedRange, undefined)
	})

	it("skips the approval prompt for automatic condensation", async () => {
		const { card, compaction, dependencies } = createMocks()
		sinon.stub(compaction as any, "generateSummary").resolves("completed summary")

		await compaction.run({ source: "automatic" })

		assert.equal(card.waitForInteraction.callCount, 0)
		const cardParams = dependencies.taskMessenger.createCard.firstCall.args[0]
		assert.equal(cardParams.requireApproval, undefined)
		assert.match(cardParams.header, /^Condensing Conversation/)
	})
})

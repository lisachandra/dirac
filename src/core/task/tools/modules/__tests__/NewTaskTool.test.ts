import { strict as assert } from "node:assert"
import { DiracDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { toolSpecFunctionDefinition } from "@core/prompts/system-prompt/spec"
import { new_task_spec, NewTaskTool } from "../new_task/NewTaskTool"

function createMocks() {
	const card = {
		update: sinon.stub().resolves(),
		appendBody: sinon.stub().resolves(),
		finalize: sinon.stub().resolves(),
		waitForInteraction: sinon.stub().resolves({
			action: DiracDefaultTool.NEW_TASK,
			response: "approve",
			value: DiracDefaultTool.NEW_TASK,
		}),
	}
	const abortController = new AbortController()
	const state: Record<string, unknown> = {
		consecutiveMistakeCount: 0,
		abortSignal: abortController.signal,
	}
	const conversationCondensation = {
		isAvailable: sinon.stub().returns(false),
		condenseConversation: sinon.stub(),
	}
	const env = {
		ui: {
			createCard: sinon.stub().resolves(card),
			upsertText: sinon.stub().resolves(),
		},
		conversationCondensation,
		logging: { warn: sinon.stub() },
		orchestration: {
			getTaskState: sinon.stub().callsFake((key: keyof typeof state) => state[key]),
			setTaskState: sinon.stub().callsFake((key: string, value: unknown) => {
				state[key] = value
			}),
			requestTaskReplacement: sinon.stub(),
		},
		config: {
			isSubagentExecution: false,
			autoApprovalSettings: { enableNotifications: false },
			ulid: "ulid-1",
			mode: "act",
			providerId: "provider-1",
			model: { id: "model-1", info: {} },
			services: {},
		},
	}
	return { abortController, card, env, state, conversationCondensation }
}

describe("NewTaskTool", () => {
	afterEach(() => sinon.restore())

	it("exposes a required context only when Utility handoff generation is unavailable", () => {
		const tool = toolSpecFunctionDefinition(
			new_task_spec,
			{
				providerInfo: { providerId: "openai", model: { id: "model", info: { supportsStrictTools: true } }, mode: "act" },
				ide: "test",
				taskHandoffCondensationAvailable: false,
			} as any,
			true,
		) as any

		assert.deepEqual(Object.keys(tool.function.parameters.properties), ["context"])
		assert.deepEqual(tool.function.parameters.required, ["context"])
		assert.match(tool.function.description, /handoff that you generate/)
	})

	it("exposes only a bounded concise intent when Utility handoff generation is available", () => {
		const tool = toolSpecFunctionDefinition(
			new_task_spec,
			{
				providerInfo: { providerId: "openai", model: { id: "model", info: { supportsStrictTools: true } }, mode: "act" },
				ide: "test",
				taskHandoffCondensationAvailable: true,
			} as any,
			true,
		) as any

		assert.deepEqual(Object.keys(tool.function.parameters.properties), ["intent"])
		assert.deepEqual(tool.function.parameters.required, ["intent"])
		assert.match(tool.function.parameters.properties.intent.description, /one or two short sentences/)
		assert.match(tool.function.parameters.properties.intent.description, /no more than 40 words/)
		assert.match(tool.function.description, /concise intent/)
	})

	it("creates an expanded completion-sized markdown card with promoted new-task actions", async () => {
		const { card, env } = createMocks()
		const context = "# Current work\n\nContinue from this exact context."

		await new NewTaskTool().processCall({ context }, env as any)

		assert.ok(
			env.ui.createCard.calledWithMatch({
				header: "New Task",
				body: context,
				renderType: "markdown",
				rawInput: { tool: DiracDefaultTool.NEW_TASK },
				collapsed: false,
				maxHeight: 1200,
				do_not_auto_collapse: true,
				actions: [{ label: "Approve New Task", value: DiracDefaultTool.NEW_TASK, primary: true }],
			}),
		)
		assert.ok(card.waitForInteraction.calledOnce)
		assert.ok(card.finalize.calledWith("success"))
		assert.ok(card.update.calledWithMatch({ header: "New Task Created" }))
		assert.ok(env.orchestration.requestTaskReplacement.calledOnceWithExactly(context))
	})

	it("treats composer content as feedback instead of replacing the task", async () => {
		const { card, env } = createMocks()
		card.waitForInteraction.resolves({
			action: DiracDefaultTool.NEW_TASK,
			response: "approve",
			value: DiracDefaultTool.NEW_TASK,
			text: "Change the plan",
			images: ["data:image/png;base64,iVBORw0KGgo="],
		})

		await new NewTaskTool().processCall({ context: "Generated context" }, env as any)

		assert.ok(card.finalize.calledWith("cancelled"))
		assert.ok(env.ui.upsertText.calledWith("Change the plan", false, "user"))
		assert.equal(env.orchestration.requestTaskReplacement.called, false)
	})

	it("keeps the current task on rejection without inserting empty feedback", async () => {
		const { card, env } = createMocks()
		card.waitForInteraction.resolves({
			action: "reject",
			response: "reject",
			value: "reject",
		})

		const result = await new NewTaskTool().processCall({ context: "Generated context" }, env as any)

		assert.match(result, /kept the current task/)
		assert.ok(card.finalize.calledWith("cancelled"))
		assert.equal(env.ui.upsertText.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})

	it("delegates a concise intent directly to the authoritative Utility condensation operation", async () => {
		const { card, env, conversationCondensation } = createMocks()
		conversationCondensation.condenseConversation.resolves({
			text: "# Completed handoff",
			modelIdentity: { providerId: "openai", modelId: "utility-model" },
		})

		await new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)

		assert.equal(conversationCondensation.isAvailable.callCount, 0)
		assert.ok(
			conversationCondensation.condenseConversation.calledWithMatch(
				"task_handoff",
				sinon.match({
					historyScope: "complete",
					additionalSourceText: sinon.match(/Continue the requested implementation/),
				}),
			),
		)
		assert.ok(
			env.ui.createCard.calledWithMatch({
				header: "New Task · openai/utility-model",
				body: "# Completed handoff",
			}),
		)
		assert.ok(card.update.calledWithMatch({ header: "New Task Created · openai/utility-model" }))
		assert.ok(card.finalize.calledWith("success"))
		assert.ok(env.orchestration.requestTaskReplacement.calledOnceWithExactly("# Completed handoff"))
	})
	it("surfaces an unavailable Utility operation without previewing or replacing", async () => {
		const { env, conversationCondensation } = createMocks()
		conversationCondensation.condenseConversation.rejects(new Error("Conversation condensation is unavailable"))

		const result = await new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)

		assert.match(result, /Utility task-handoff generation failed: Conversation condensation is unavailable/)
		assert.equal(conversationCondensation.condenseConversation.callCount, 1)
		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})
	it("does not preview a generated handoff until the completed result is available", async () => {
		const { env, conversationCondensation } = createMocks()
		let resolveHandoff: (handoff: {
			text: string
			modelIdentity: { providerId: string; modelId: string }
		}) => void = () => assert.fail("Expected handoff resolution")
		conversationCondensation.condenseConversation.returns(
			new Promise((resolve) => {
				resolveHandoff = resolve
			}),
		)

		const processing = new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(env.ui.createCard.callCount, 0)

		resolveHandoff({
			text: "# Completed handoff",
			modelIdentity: { providerId: "openai", modelId: "utility-model" },
		})
		await processing
		assert.equal(env.ui.createCard.callCount, 1)
	})

	it("surfaces the original Utility error without previewing or replacing", async () => {
		const { env, state, conversationCondensation } = createMocks()
		conversationCondensation.condenseConversation.rejects(new Error("provider rejected utility-model"))

		const result = await new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any)

		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
		assert.equal(state.consecutiveMistakeCount, 0)
		assert.match(result, /Utility task-handoff generation failed: provider rejected utility-model/)
	})

	it("propagates task cancellation without fallback, preview, or replacement", async () => {
		const { abortController, env, conversationCondensation } = createMocks()
		conversationCondensation.condenseConversation.callsFake(async (_template: string, options: { signal?: AbortSignal }) => {
			assert.equal(options.signal, abortController.signal)
			abortController.abort()
			throw new Error("cancelled")
		})

		await assert.rejects(
			new NewTaskTool().processCall({ intent: "Continue the requested implementation." }, env as any),
			/cancelled/,
		)

		assert.equal(env.logging.warn.callCount, 0)
		assert.equal(env.ui.createCard.callCount, 0)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})

	it("finalizes the preview as an error without masking an interaction failure", async () => {
		const { card, env } = createMocks()
		const interactionFailure = new Error("preview interaction failed")
		card.waitForInteraction.rejects(interactionFailure)

		await assert.rejects(
			() => new NewTaskTool().processCall({ context: "handoff" }, env as any),
			(error: unknown) => error === interactionFailure,
		)

		assert.ok(card.finalize.calledWith("error"))
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
	})

	it("does not replace the task when cancellation arrives after approval", async () => {
		const { abortController, card, env } = createMocks()
		card.waitForInteraction.callsFake(async () => {
			abortController.abort()
			return {
				action: DiracDefaultTool.NEW_TASK,
				response: "approve",
				value: DiracDefaultTool.NEW_TASK,
			}
		})

		await assert.rejects(new NewTaskTool().processCall({ context: "handoff" }, env as any), /Task instance aborted/)

		assert.equal(env.orchestration.requestTaskReplacement.callCount, 0)
		assert.ok(card.finalize.calledWith("cancelled"))
	})

	it("keeps the committed replacement when final presentation is interrupted", async () => {
		const { abortController, card, env } = createMocks()
		card.finalize.callsFake(async () => {
			abortController.abort()
		})

		const result = await new NewTaskTool().processCall({ context: "handoff" }, env as any)

		assert.match(result, /created a new task/)
		assert.equal(env.orchestration.requestTaskReplacement.callCount, 1)
	})
})

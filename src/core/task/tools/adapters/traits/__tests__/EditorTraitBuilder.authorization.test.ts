import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { buildEditorTrait } from "../EditorTraitBuilder"

describe("EditorTraitBuilder mutation authorization", () => {
	function createConfig(toolName = "edit_file") {
		const assertMutationAuthorized = sinon.stub()
		const withMutationAuthorization = sinon.stub().callsFake(async (_name, mutation) => {
			assertMutationAuthorized(_name)
			return await mutation()
		})
		const diffViewProvider = {
			open: sinon.stub().resolves(),
			update: sinon.stub().resolves(),
			saveChanges: sinon.stub().resolves({ finalContent: "saved" }),
			applyAndSaveSilently: sinon.stub().resolves({ finalContent: "saved" }),
			applyAndSaveBatchSilently: sinon.stub().resolves(new Map()),
		} as any
		const config = {
			toolUse: { name: toolName, params: {} },
			callbacks: { assertMutationAuthorized, withMutationAuthorization },
			services: { diffViewProvider },
		} as any
		return { config, assertMutationAuthorized, withMutationAuthorization, diffViewProvider }
	}

	it("holds authorization through every asynchronous editor mutation boundary", async () => {
		const { config, assertMutationAuthorized, withMutationAuthorization, diffViewProvider } = createConfig()
		const trait = buildEditorTrait(config)

		await trait.open("a.ts", { editType: "modify" })
		await trait.update("draft", true)
		await trait.saveChanges()
		await trait.applyAndSaveSilently("a.ts", "a")
		await trait.applyAndSaveBatchSilently([{ path: "b.ts", content: "b" }])

		sinon.assert.callCount(withMutationAuthorization, 5)
		sinon.assert.alwaysCalledWithMatch(withMutationAuthorization, "edit_file", sinon.match.func)
		sinon.assert.callCount(assertMutationAuthorized, 5)
		sinon.assert.calledOnce(diffViewProvider.open)
		sinon.assert.calledOnce(diffViewProvider.update)
		sinon.assert.calledOnce(diffViewProvider.saveChanges)
		sinon.assert.calledOnce(diffViewProvider.applyAndSaveSilently)
		sinon.assert.calledOnce(diffViewProvider.applyAndSaveBatchSilently)
	})

	it("fails closed for a custom tool before entering the provider", async () => {
		const { config, assertMutationAuthorized, diffViewProvider } = createConfig("custom_writer")
		assertMutationAuthorized.throws(new Error("Plan Mode revoked mutation"))
		const trait = buildEditorTrait(config)

		await assert.rejects(trait.applyAndSaveSilently("a.ts", "a"), /Plan Mode revoked mutation/)
		sinon.assert.notCalled(diffViewProvider.applyAndSaveSilently)
	})
})

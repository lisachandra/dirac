import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { refreshDiracRulesToggles } from "../dirac-rules"
import { refreshExternalRulesToggles } from "../external-rules"
import { refreshWorkflowToggles } from "../workflows"

describe("rule toggle refresh persistence", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let workspaceDir: string
	let stateManager: {
		getGlobalSettingsKey: sinon.SinonStub
		getWorkspaceStateKey: sinon.SinonStub
		setGlobalState: sinon.SinonStub
		setWorkspaceState: sinon.SinonStub
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-toggle-refresh-"))
		workspaceDir = path.join(tempDir, "workspace")
		sandbox.stub(os, "homedir").returns(tempDir)

		await Promise.all([
			fs.mkdir(path.join(tempDir, ".dirac", "Rules"), { recursive: true }),
			fs.mkdir(path.join(tempDir, ".dirac", "Workflows"), { recursive: true }),
			fs.mkdir(path.join(workspaceDir, ".diracrules", "workflows"), { recursive: true }),
			fs.mkdir(path.join(workspaceDir, ".cursor", "rules"), { recursive: true }),
		])
		await Promise.all([
			fs.writeFile(path.join(tempDir, ".dirac", "Rules", "global.md"), "global rule"),
			fs.writeFile(path.join(tempDir, ".dirac", "Workflows", "global.md"), "global workflow"),
			fs.writeFile(path.join(workspaceDir, ".diracrules", "local.md"), "local rule"),
			fs.writeFile(path.join(workspaceDir, ".diracrules", "workflows", "local.md"), "local workflow"),
			fs.writeFile(path.join(workspaceDir, ".windsurfrules"), "windsurf rule"),
			fs.writeFile(path.join(workspaceDir, ".cursor", "rules", "local.mdc"), "cursor rule"),
			fs.writeFile(path.join(workspaceDir, ".cursorrules"), "legacy cursor rule"),
			fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "agents rule"),
		])

		stateManager = {
			getGlobalSettingsKey: sandbox.stub().returns({}),
			getWorkspaceStateKey: sandbox.stub().returns({}),
			setGlobalState: sandbox.stub(),
			setWorkspaceState: sandbox.stub(),
		}
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("keeps task-snapshot synchronization request-local", async () => {
		const dirac = await refreshDiracRulesToggles(stateManager as any, workspaceDir, {
			globalToggles: {},
			localToggles: {},
		})
		const external = await refreshExternalRulesToggles(stateManager as any, workspaceDir, {
			localWindsurfRulesToggles: {},
			localCursorRulesToggles: {},
			localAgentsRulesToggles: {},
		})
		const workflows = await refreshWorkflowToggles(stateManager as any, workspaceDir, {
			globalWorkflowToggles: {},
			localWorkflowToggles: {},
		})

		expect(dirac.globalToggles[path.join(tempDir, ".dirac", "Rules", "global.md")]).to.equal(true)
		expect(dirac.localToggles[path.join(workspaceDir, ".diracrules", "local.md")]).to.equal(true)
		expect(external.windsurfLocalToggles[path.join(workspaceDir, ".windsurfrules")]).to.equal(true)
		expect(external.cursorLocalToggles[path.join(workspaceDir, ".cursor", "rules", "local.mdc")]).to.equal(true)
		expect(external.agentsLocalToggles[path.join(workspaceDir, "AGENTS.md")]).to.equal(true)
		expect(workflows.globalWorkflowToggles[path.join(tempDir, ".dirac", "Workflows", "global.md")]).to.equal(true)
		expect(workflows.localWorkflowToggles[path.join(workspaceDir, ".diracrules", "workflows", "local.md")]).to.equal(
			true,
		)
		sinon.assert.notCalled(stateManager.setGlobalState)
		sinon.assert.notCalled(stateManager.setWorkspaceState)
	})

	it("preserves persistence for explicit default refresh callers", async () => {
		await refreshDiracRulesToggles(stateManager as any, workspaceDir)
		await refreshExternalRulesToggles(stateManager as any, workspaceDir)
		await refreshWorkflowToggles(stateManager as any, workspaceDir)

		sinon.assert.calledWith(stateManager.setGlobalState, "globalDiracRulesToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setGlobalState, "globalWorkflowToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setWorkspaceState, "localDiracRulesToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setWorkspaceState, "localWindsurfRulesToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setWorkspaceState, "localCursorRulesToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setWorkspaceState, "localAgentsRulesToggles", sinon.match.object)
		sinon.assert.calledWith(stateManager.setWorkspaceState, "workflowToggles", sinon.match.object)
	})
})

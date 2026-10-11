import * as apiModule from "@core/api"
import { ToolRegistry } from "@core/task/tools/registry/ToolRegistry"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { AutoApprovalSettingsRequest, UpdateSettingsRequest, UpdateTaskSettingsRequest } from "@shared/proto/dirac/state"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { updateAutoApprovalSettings } from "../updateAutoApprovalSettings"
import { updateSettings } from "../updateSettings"
import { updateTaskSettings } from "../updateTaskSettings"

describe("settings active-task ingress characterization", () => {
	let settings: Record<string, any>
	let taskSettings: Record<string, Record<string, any>>
	let stateManager: any
	let task: any
	let controller: any

	beforeEach(() => {
		sinon.stub(Logger, "error")
		sinon.stub(Logger, "log")
		sinon.stub(apiModule, "buildApiHandler").returns({} as any)
		settings = {
			mode: "act",
			browserSettings: { ...DEFAULT_BROWSER_SETTINGS },
			autoApprovalSettings: {
				version: 1,
				enableNotifications: false,
				actions: { readFiles: true, editFiles: false },
			},
		}
		taskSettings = {}
		stateManager = {
			getGlobalSettingsKey: sinon.stub().callsFake((key: string) => settings[key]),
			getSystemDefaultSettingsKey: sinon.stub().callsFake((key: string) => settings[key]),
			getApiConfiguration: sinon.stub().returns({
				planModeApiProvider: "anthropic",
				actModeApiProvider: "anthropic",
			}),
			setGlobalState: sinon.stub().callsFake((key: string, value: unknown) => {
				settings[key] = value
			}),
			setGlobalStateBatch: sinon.stub().callsFake((updates: Record<string, unknown>) => Object.assign(settings, updates)),
			setSessionOverride: sinon.stub(),
			setApiConfiguration: sinon.stub(),
			setTaskSettings: sinon.stub().callsFake((taskId: string, key: string, value: unknown) => {
				;(taskSettings[taskId] ??= {})[key] = value
			}),
			setTaskSettingsBatch: sinon.stub().callsFake((taskId: string, updates: Record<string, unknown>) => {
				Object.assign((taskSettings[taskId] ??= {}), updates)
			}),
			hasTaskSetting: sinon.stub().callsFake((key: string) => Object.hasOwn(taskSettings["active-task"] ?? {}, key)),
			getTaskSetting: sinon.stub().callsFake((key: string) => taskSettings["active-task"]?.[key]),
			clearTaskSetting: sinon.stub().callsFake((taskId: string, key: string) => {
				if (taskSettings[taskId]) delete taskSettings[taskId][key]
			}),
		}
		task = {
			taskId: "active-task",
			ulid: "active-ulid",
			api: { getModel: () => ({ id: "active-model" }) },
			getWorkingConfiguration: sinon.stub().callsFake(() => ({
				revision: 1,
				settings: structuredClone(settings),
				apiConfiguration: stateManager.getApiConfiguration(),
				workspaceConfiguration: {},
				executionOptions: {
					terminalReuseEnabled: true,
					vscodeTerminalExecutionMode: "vscodeTerminal",
					multiRootEnabled: false,
				},
			})),
			markToolsDirty: sinon.stub(),
			applyLatestBrowserSettings: sinon.stub().resolves(),
			applyWorkingConfigurationUpdate: sinon.stub().callsFake(async (patch: any, beforeCommit?: () => void) => {
				const current = task.getWorkingConfiguration()
				task.lastAppliedPatch = typeof patch === "function" ? patch(current) : patch
				beforeCommit?.()
			}),
		}
		controller = {
			stateManager,
			task,
			postStateToWebview: sinon.stub().resolves(),
			updateTelemetrySetting: sinon.stub().resolves(),
			getStateToPostToWebview: sinon.stub().callsFake(async () => ({
				autoApprovalSettings: settings.autoApprovalSettings,
			})),
		}
	})

	afterEach(() => sinon.restore())

	it("browser settings from updateSettings persist and patch the active task from its own browser base", async () => {
		await updateSettings(
			controller,
			UpdateSettingsRequest.create({
				browserSettings: { remoteBrowserEnabled: true, viewport: { width: 1200, height: 800 } } as any,
			}),
		)

		expect(stateManager.setGlobalState.calledWith("browserSettings", sinon.match({ remoteBrowserEnabled: true }))).to.equal(
			true,
		)
		expect(task.applyWorkingConfigurationUpdate.calledOnce).to.equal(true)
		expect(task.lastAppliedPatch.settings.browserSettings).to.include({
			remoteBrowserEnabled: true,
		})
	})

	it("auto-approve-all from updateSettings persists and immediately patches the active task", async () => {
		await updateSettings(controller, UpdateSettingsRequest.create({ autoApproveAllToggled: true }))

		expect(stateManager.setGlobalState.calledWith("autoApproveAllToggled", true)).to.equal(true)
		expect(task.applyWorkingConfigurationUpdate.calledOnce).to.equal(true)
		expect(task.lastAppliedPatch.settings).to.include({ autoApproveAllToggled: true })
	})

	it("the versioned auto-approval endpoint persists and patches the active task", async () => {
		await updateAutoApprovalSettings(
			controller,
			AutoApprovalSettingsRequest.create({
				version: 2,
				enableNotifications: true,
				actions: { editFiles: true } as any,
			}),
		)

		expect(stateManager.setGlobalState.calledWith("autoApprovalSettings", sinon.match({ version: 2 }))).to.equal(true)
		expect(task.applyWorkingConfigurationUpdate.calledOnce).to.equal(true)
		expect(task.lastAppliedPatch.settings.autoApprovalSettings).to.deep.include({
			version: 2,
			enableNotifications: true,
		})
	})

	it("Utility permission settings persist globally and immediately patch the active task", async () => {
		await updateSettings(
			controller,
			UpdateSettingsRequest.create({
				utilityModelUsePermissionHandling: true,
				utilityModelPermissionPolicy: "Allow edits in this repository.",
			}),
		)

		expect(settings).to.include({
			utilityModelUsePermissionHandling: true,
			utilityModelPermissionPolicy: "Allow edits in this repository.",
		})
		expect(task.lastAppliedPatch.settings).to.include({
			utilityModelUsePermissionHandling: true,
			utilityModelPermissionPolicy: "Allow edits in this repository.",
		})
	})

	it("disabling Utility permission handling restores disabled settings on the active task", async () => {
		settings.utilityModelUsePermissionHandling = true
		settings.utilityModelPermissionPolicy = "Allow edits."

		await updateSettings(
			controller,
			UpdateSettingsRequest.create({
				utilityModelUsePermissionHandling: false,
				utilityModelPermissionPolicy: "",
			}),
		)

		expect(settings).to.include({
			utilityModelUsePermissionHandling: false,
			utilityModelPermissionPolicy: "",
		})
		expect(task.lastAppliedPatch.settings).to.include({
			utilityModelUsePermissionHandling: false,
			utilityModelPermissionPolicy: "",
		})
	})

	it("tool toggles persist and patch the active task inventory source", async () => {
		const registry = ToolRegistry.getInstance()
		sinon.stub(registry, "loadToggles")
		sinon.stub(registry, "getToggles").returns({ edit_file: false })

		await updateSettings(controller, UpdateSettingsRequest.create({ toolToggles: JSON.stringify({ edit_file: false }) }))

		expect(stateManager.setGlobalState.calledWith("toolToggles", { edit_file: false })).to.equal(true)
		expect(task.applyWorkingConfigurationUpdate.calledOnce).to.equal(true)
		expect(task.lastAppliedPatch.settings.toolToggles).to.deep.equal({ edit_file: false })
	})

	it("active task-specific settings update only the task persistence cache and publish state", async () => {
		await updateTaskSettings(
			controller,
			UpdateTaskSettingsRequest.create({
				settings: {
					preferredLanguage: "French",
					autoApproveAllToggled: true,
					browserSettings: { remoteBrowserEnabled: true } as any,
					utilityModelUsePermissionHandling: true,
					utilityModelPermissionPolicy: "Never allow network calls.",
				} as any,
			}),
		)

		expect(
			stateManager.setTaskSettingsBatch.calledWith("active-task", sinon.match({ preferredLanguage: "French" })),
		).to.equal(true)
		expect(
			stateManager.setTaskSettingsBatch.calledWith("active-task", sinon.match({ browserSettings: sinon.match.object })),
		).to.equal(true)
		expect(
			stateManager.setTaskSettingsBatch.calledWith(
				"active-task",
				sinon.match({
					utilityModelUsePermissionHandling: true,
					utilityModelPermissionPolicy: "Never allow network calls.",
				}),
			),
		).to.equal(true)
		expect(task.markToolsDirty.called).to.equal(false)
		expect(task.applyLatestBrowserSettings.called).to.equal(false)
		expect(task.applyWorkingConfigurationUpdate.calledOnce).to.equal(true)
		expect(task.lastAppliedPatch.settings).to.include({
			preferredLanguage: "French",
			autoApproveAllToggled: true,
			utilityModelUsePermissionHandling: true,
			utilityModelPermissionPolicy: "Never allow network calls.",
		})
		expect(task.lastAppliedPatch.settings.browserSettings).to.include({
			remoteBrowserEnabled: true,
		})
		expect(controller.postStateToWebview.calledOnce).to.equal(true)
	})
})

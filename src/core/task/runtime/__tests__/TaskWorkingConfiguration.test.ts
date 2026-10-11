import { expect } from "chai"
import { describe, it } from "mocha"
import type { ApiConfiguration } from "@shared/api"
import type { LocalState, Settings } from "@shared/storage/state-keys"
import { buildTaskWorkingConfigurationUpdate, createTaskWorkingConfiguration } from "../TaskWorkingConfiguration"

function createConfiguration() {
	return createTaskWorkingConfiguration({
		settings: {
			mode: "plan",
			browserSettings: { viewport: { width: 900, height: 700 }, customArgs: ["--test"].join(" ") },
			autoApprovalSettings: {
				version: 1,
				enabled: true,
				favorites: [],
				maxRequests: 20,
				enableNotifications: false,
				actions: { readFiles: true, editFiles: false, executeCommands: false, useBrowser: false },
			},
		} as unknown as Settings,
		apiConfiguration: { planModeApiProvider: "anthropic", apiKey: "private" } as ApiConfiguration,
		workspaceConfiguration: {
			localDiracRulesToggles: { "rule.md": true },
		} as unknown as LocalState,
		executionOptions: {
			terminalReuseEnabled: true,
			vscodeTerminalExecutionMode: "vscodeTerminal",
			multiRootEnabled: false,
		},
	})
}

describe("TaskWorkingConfiguration", () => {
	it("deeply detaches and freezes captured values", () => {
		const mutableSettings = {
			mode: "plan",
			browserSettings: { viewport: { width: 900, height: 700 } },
		} as unknown as Settings
		const configuration = createTaskWorkingConfiguration({
			settings: mutableSettings,
			apiConfiguration: { planModeApiProvider: "anthropic", apiKey: "private" } as ApiConfiguration,
			workspaceConfiguration: { localSkillsToggles: { skill: true } } as unknown as LocalState,
			executionOptions: {
				terminalReuseEnabled: true,
				vscodeTerminalExecutionMode: "backgroundExec",
				multiRootEnabled: true,
			},
		})

		mutableSettings.mode = "act"
		mutableSettings.browserSettings.viewport.width = 1

		expect(configuration.revision).to.equal(1)
		expect(configuration.settings.mode).to.equal("plan")
		expect(configuration.settings.browserSettings.viewport.width).to.equal(900)
		expect(Object.isFrozen(configuration)).to.equal(true)
		expect(Object.isFrozen(configuration.settings.browserSettings.viewport)).to.equal(true)
		expect(() => {
			; (configuration.settings.browserSettings.viewport as { width: number }).width = 1
		}).to.throw(TypeError)
	})

	it("preserves owned undefined values", () => {
		const settings = { mode: "plan", actModeApiModelId: undefined } as unknown as Settings
		const configuration = createTaskWorkingConfiguration({
			settings,
			apiConfiguration: {} as ApiConfiguration,
			workspaceConfiguration: {} as unknown as LocalState,
			executionOptions: {
				terminalReuseEnabled: true,
				vscodeTerminalExecutionMode: "vscodeTerminal",
				multiRootEnabled: false,
			},
		})

		expect(Object.hasOwn(configuration.settings, "actModeApiModelId")).to.equal(true)
		expect(configuration.settings.actModeApiModelId).to.equal(undefined)
	})

	it("builds an update only from the current revision and explicit patch", () => {
		const current = createConfiguration()
		const next = buildTaskWorkingConfigurationUpdate(current, { settings: { mode: "act" } })

		expect(next.revision).to.equal(2)
		expect(next.settings.mode).to.equal("act")
		expect(next.settings.browserSettings.viewport.width).to.equal(900)
		expect(next.apiConfiguration.planModeApiProvider).to.equal("anthropic")
		expect(next).not.to.equal(current)
		expect(Object.isFrozen(next)).to.equal(true)
	})

	it("updates only explicit fields across nested configuration sections", () => {
		const current = createConfiguration()
		const next = buildTaskWorkingConfigurationUpdate(current, {
			settings: {
				preferredLanguage: "French",
				browserSettings: { ...current.settings.browserSettings, customArgs: "--updated" },
			},
			apiConfiguration: { openAiApiKey: "replacement-secret" },
			workspaceConfiguration: { localSkillsToggles: { skill: false } },
		})

		expect(next.revision).to.equal(current.revision + 1)
		expect(next.settings.preferredLanguage).to.equal("French")
		expect(next.settings.browserSettings.customArgs).to.equal("--updated")
		expect(next.settings.mode).to.equal(current.settings.mode)
		expect(next.settings.autoApprovalSettings).to.deep.equal(current.settings.autoApprovalSettings)
		expect(next.apiConfiguration.openAiApiKey).to.equal("replacement-secret")
		expect(next.apiConfiguration.apiKey).to.equal(current.apiConfiguration.apiKey)
		expect(next.workspaceConfiguration.localSkillsToggles).to.deep.equal({ skill: false })
		expect(next.workspaceConfiguration.localDiracRulesToggles).to.deep.equal(
			current.workspaceConfiguration.localDiracRulesToggles,
		)
		expect(current.settings.preferredLanguage).to.equal(undefined)
		expect(current.apiConfiguration.openAiApiKey).to.equal(undefined)
		expect(Object.isFrozen(next.workspaceConfiguration.localSkillsToggles)).to.equal(true)
	})

	it("synchronizes API-handler settings in both patch directions without leaking unrelated values", () => {
		const current = createConfiguration()
		const fromSettings = buildTaskWorkingConfigurationUpdate(current, {
			settings: { actModeApiProvider: "openai", actModeOpenAiModelId: "settings-model:1m" },
		})
		expect(fromSettings.apiConfiguration.actModeApiProvider).to.equal("openai")
		expect(fromSettings.apiConfiguration.actModeOpenAiModelId).to.equal("settings-model")
		expect(fromSettings.apiConfiguration.planModeApiProvider).to.equal(current.apiConfiguration.planModeApiProvider)

		const fromApi = buildTaskWorkingConfigurationUpdate(fromSettings, {
			apiConfiguration: { planModeApiProvider: "openrouter", planModeOpenRouterModelId: "api-model:1m" },
		})
		expect(fromApi.settings.planModeApiProvider).to.equal("openrouter")
		expect(fromApi.settings.planModeOpenRouterModelId).to.equal("api-model")
		expect(fromApi.settings.actModeApiProvider).to.equal("openai")
		expect(fromApi.apiConfiguration.apiKey).to.equal(current.apiConfiguration.apiKey)
	})


	it("keeps execution options construction-owned across active updates", () => {
		const current = createConfiguration()
		const next = buildTaskWorkingConfigurationUpdate(current, { settings: { preferredLanguage: "French" } })

		expect(next.executionOptions).to.deep.equal(current.executionOptions)
		expect(next.executionOptions).not.to.equal(current.executionOptions)
	})
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const stateManager = {
	getGlobalSettingsKey: vi.fn(),
	getApiConfiguration: vi.fn(),
	getSecretKey: vi.fn(),
	setApiConfiguration: vi.fn(),
	flushPendingState: vi.fn(),
}

const applyApiConfigurationTransaction = vi.fn(
	async (
		controller: any,
		_configuration: Record<string, unknown>,
		persist: () => void | Promise<void>,
		_mode?: unknown,
		activePatch?: Record<string, unknown>,
	) => {
		if (controller.task) {
			await controller.task.applyWorkingConfigurationUpdate(
				{ apiConfiguration: activePatch },
				persist,
			)
		} else {
			await persist()
		}
	},
)

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: vi.fn(() => stateManager) },
}))

vi.mock("@shared/storage", () => ({
	getProviderModelIdKey: (provider: string, mode: "act" | "plan") =>
		provider === "bedrock"
			? mode === "act"
				? "actModeAwsBedrockModelId"
				: "planModeAwsBedrockModelId"
			: mode === "act"
				? "actModeOpenRouterModelId"
				: "planModeOpenRouterModelId",
	isSecretKey: (key: string) => ["openRouterApiKey", "awsAccessKey", "awsSecretKey", "awsSessionToken"].includes(key),
	ProviderToApiKeyMap: { openrouter: "openRouterApiKey" },
	ProviderToBaseUrlKeyMap: {},
}))

vi.mock("@/core/controller/models/apiConfigurationTransaction", () => ({
	applyApiConfigurationTransaction,
}))

vi.mock("@/core/controller/models/refreshOpenRouterModels", () => ({
	refreshOpenRouterModels: vi.fn(),
}))

vi.mock("@/core/controller/models/refreshVercelAiGatewayModels", () => ({
	refreshVercelAiGatewayModels: vi.fn(),
}))

vi.mock("./model-metadata", () => ({
	getDefaultModelId: vi.fn(() => ""),
	getModelList: vi.fn(() => []),
}))

const { applyBedrockConfig, applyProviderConfig } = await import("./provider-config")

function createController(task?: any) {
	return {
		task,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as any
}

describe("provider configuration transactions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		stateManager.getGlobalSettingsKey.mockReturnValue(undefined)
		stateManager.getApiConfiguration.mockReturnValue({
			actModeApiProvider: "anthropic",
			planModeApiProvider: "anthropic",
			openRouterApiKey: "redacted-from-settings-view",
		})
		stateManager.getSecretKey.mockImplementation((key: string) =>
			key === "openRouterApiKey" ? "old-secret" : undefined,
		)
		stateManager.flushPendingState.mockResolvedValue(undefined)
	})

	it("rejects OpenRouter without an explicit or saved model", async () => {
		await expect(applyProviderConfig({ providerId: "openrouter" })).rejects.toThrow(
			"Select an OpenRouter model before configuring the provider",
		)
		expect(stateManager.setApiConfiguration).not.toHaveBeenCalled()
	})

	it("validates the active Task candidate before provider fields are written", async () => {
		const invalidCandidate = new Error("invalid candidate")
		const task = {
			applyWorkingConfigurationUpdate: vi.fn().mockRejectedValue(invalidCandidate),
		}
		const controller = createController(task)

		await expect(
			applyProviderConfig({ providerId: "openrouter", modelId: "model", apiKey: "new-secret", controller }),
		).rejects.toBe(invalidCandidate)

		expect(task.applyWorkingConfigurationUpdate).toHaveBeenCalledTimes(1)
		expect(stateManager.setApiConfiguration).not.toHaveBeenCalled()
		expect(stateManager.flushPendingState).not.toHaveBeenCalled()
		expect(controller.postStateToWebview).not.toHaveBeenCalled()
	})

	it("restores only explicitly addressed provider fields when durable flush fails", async () => {
		const flushError = new Error("flush failed")
		let taskRevision = 7
		stateManager.flushPendingState.mockRejectedValueOnce(flushError).mockResolvedValueOnce(undefined)
		const task = {
			applyWorkingConfigurationUpdate: vi.fn(async (_patch, beforeCommit) => {
				await beforeCommit()
				taskRevision += 1
			}),
		}
		const controller = createController(task)

		await expect(
			applyProviderConfig({ providerId: "openrouter", modelId: "model", apiKey: "new-secret", controller }),
		).rejects.toBe(flushError)

		expect(stateManager.setApiConfiguration).toHaveBeenCalledTimes(2)
		const written = stateManager.setApiConfiguration.mock.calls[0][0]
		const restored = stateManager.setApiConfiguration.mock.calls[1][0]
		expect(written).toMatchObject({
			actModeApiProvider: "openrouter",
			planModeApiProvider: "openrouter",
			openRouterApiKey: "new-secret",
		})
		expect(restored).toEqual(
			Object.fromEntries(
				Object.keys(written).map((key) => [key, key === "openRouterApiKey" ? "old-secret" : stateManager.getApiConfiguration.mock.results[0].value[key]]),
			),
		)
		expect(restored).not.toHaveProperty("unrelatedSetting")
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(2)
		expect(taskRevision).toBe(7)
		expect(controller.postStateToWebview).not.toHaveBeenCalled()
	})

	it("commits and publishes provider configuration after a successful flush", async () => {
		const task = {
			applyWorkingConfigurationUpdate: vi.fn(async (_patch, beforeCommit) => {
				await beforeCommit()
			}),
		}
		const controller = createController(task)

		await applyProviderConfig({ providerId: "openrouter", modelId: "model", apiKey: "new-secret", controller })

		expect(task.applyWorkingConfigurationUpdate).toHaveBeenCalledTimes(1)
		expect(stateManager.setApiConfiguration).toHaveBeenCalledTimes(1)
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(1)
		expect(controller.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("uses the same rollback-safe persistence boundary for Bedrock", async () => {
		const flushError = new Error("bedrock flush failed")
		stateManager.flushPendingState.mockRejectedValueOnce(flushError).mockResolvedValueOnce(undefined)
		const task = {
			applyWorkingConfigurationUpdate: vi.fn(async (_patch, beforeCommit) => {
				await beforeCommit()
			}),
		}
		const controller = createController(task)

		await expect(
			applyBedrockConfig({
				bedrockConfig: {
					awsAuthentication: "credentials",
					awsRegion: "us-east-1",
					awsUseCrossRegionInference: false,
					awsAccessKey: "new-access",
					awsSecretKey: "new-secret",
				} as any,
				modelId: "bedrock-model",
				controller,
			}),
		).rejects.toBe(flushError)

		expect(stateManager.setApiConfiguration).toHaveBeenCalledTimes(2)
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(2)
		expect(controller.postStateToWebview).not.toHaveBeenCalled()
	})

	it("preserves the no-controller persistence and flush behavior", async () => {
		await applyProviderConfig({ providerId: "openrouter", modelId: "model", apiKey: "new-secret" })

		expect(applyApiConfigurationTransaction).not.toHaveBeenCalled()
		expect(stateManager.setApiConfiguration).toHaveBeenCalledTimes(1)
		expect(stateManager.flushPendingState).toHaveBeenCalledTimes(1)
	})
})

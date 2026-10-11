import { ALL_MODEL_MAPS, ALL_PROVIDERS, type ApiProvider, type ModelInfo, type ModelProviderSelection } from "@shared/api"
import PROVIDERS from "@shared/providers/providers.json"
import { convertModelProviderSelectionToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { SETTINGS_HELP } from "@shared/settings-presentation"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { ModelAutocomplete } from "./common/ModelAutocomplete"
import { persistSetting, updateSetting } from "./utils/settingsHandlers"

const USE_CASES = [
	{
		field: "utilityModelUseCondense" as const,
		label: "Condense conversations",
		description: "Summarize long conversations before their context limit is reached.",
	},
	{
		field: "utilityModelUseNewTask" as const,
		label: "New task handoffs",
		description: "Generate complete task handoffs from concise new-task intents.",
	},
	{
		field: "utilityModelUseGenerateCommitMessage" as const,
		label: "Generate commit messages",
		description: "Generate Git commit messages in VS Code.",
	},
	{
		field: "utilityModelUsePermissionHandling" as const,
		label: "Handle permission requests",
		description: "Apply your policy to approve tool permission requests or escalate them to you.",
	},
]

function getProviderModels(provider: ApiProvider, dynamicModels: Record<string, unknown>): Record<string, ModelInfo> {
	const staticModels = ALL_MODEL_MAPS.filter(([candidate]) => candidate === provider).reduce<Record<string, ModelInfo>>(
		(models, [, candidateModels]) => ({ ...models, ...candidateModels }),
		{},
	)
	const providerModels = dynamicModels[provider]
	return providerModels && typeof providerModels === "object"
		? { ...staticModels, ...(providerModels as Record<string, ModelInfo>) }
		: staticModels
}

function getProviderLabel(provider: ApiProvider): string {
	return PROVIDERS.list.find((candidate) => candidate.value === provider)?.label ?? provider
}

const UtilityModelSelection = () => {
	const {
		utilityModelSelection,
		utilityModelUseCondense,
		utilityModelUseNewTask,
		utilityModelUseGenerateCommitMessage,
		utilityModelUsePermissionHandling,
		utilityModelPermissionPolicy,
		openRouterModels,
		openAiModels,
		liteLlmModels,
		requestyModels,
		groqModels,
		basetenModels,
		huggingFaceModels,
		vercelAiGatewayModels,
	} = useSettingsStore()
	const dynamicModels = useMemo<Record<string, unknown>>(
		() => ({
			openrouter: openRouterModels,
			openai: openAiModels,
			litellm: liteLlmModels,
			requesty: requestyModels,
			groq: groqModels,
			baseten: basetenModels,
			huggingface: huggingFaceModels,
			"vercel-ai-gateway": vercelAiGatewayModels,
		}),
		[
			basetenModels,
			groqModels,
			huggingFaceModels,
			liteLlmModels,
			openAiModels,
			openRouterModels,
			requestyModels,
			vercelAiGatewayModels,
		],
	)
	const [pendingSelection, setPendingSelection] = useState<ModelProviderSelection | undefined>()
	useEffect(() => setPendingSelection(undefined), [utilityModelSelection])
	const [permissionPolicy, setPermissionPolicy] = useState(utilityModelPermissionPolicy)
	useEffect(() => setPermissionPolicy(utilityModelPermissionPolicy), [utilityModelPermissionPolicy])
	const [permissionPolicySaving, setPermissionPolicySaving] = useState(false)
	const [permissionPolicySaveError, setPermissionPolicySaveError] = useState(false)
	const selection = pendingSelection ?? utilityModelSelection
	const provider = selection?.provider ?? "openrouter"
	const models = useMemo(() => getProviderModels(provider, dynamicModels), [dynamicModels, provider])
	const anyUseCaseEnabled =
		utilityModelUseCondense ||
		utilityModelUseNewTask ||
		utilityModelUseGenerateCommitMessage ||
		utilityModelUsePermissionHandling

	const persistSelection = (nextSelection: ModelProviderSelection) => {
		setPendingSelection(nextSelection)
		updateSetting("utilityModelSelection", convertModelProviderSelectionToProto(nextSelection))
	}

	const handleProviderChange = (nextProvider: ApiProvider) => {
		const nextModels = getProviderModels(nextProvider, dynamicModels)
		const modelId = Object.keys(nextModels)[0] ?? ""
		persistSelection({ provider: nextProvider, modelId, modelInfo: nextModels[modelId] })
	}

	const handleModelChange = (modelId: string, modelInfo: ModelInfo | undefined) => {
		persistSelection({
			provider,
			modelId,
			modelInfo,
			openAiProfileName: selection?.openAiProfileName,
			vsCodeLmModelSelector: selection?.vsCodeLmModelSelector,
			awsBedrockCustomSelected: selection?.awsBedrockCustomSelected,
			awsBedrockCustomModelBaseId: selection?.awsBedrockCustomModelBaseId,
		})
	}

	const persistPermissionPolicy = async () => {
		if (permissionPolicy === utilityModelPermissionPolicy) return
		setPermissionPolicySaving(true)
		setPermissionPolicySaveError(false)
		try {
			await persistSetting("utilityModelPermissionPolicy", permissionPolicy)
		} catch {
			setPermissionPolicySaveError(true)
		} finally {
			setPermissionPolicySaving(false)
		}
	}

	return (
		<div className="space-y-5">
			<div>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Utility model</div>
				<p className="mt-1 text-xs text-description">
					Choose a separate provider and model for supporting operations. It uses credentials already configured for
					that provider; credentials are not copied into the Utility Model selection.
				</p>
			</div>

			<div className="space-y-3">
				<label className="flex flex-col gap-1 text-sm" htmlFor="utility-model-provider">
					<span className="font-medium">API Provider</span>
					<select
						aria-label="Utility model provider"
						className="w-full rounded-sm border border-(--vscode-dropdown-border) bg-(--vscode-dropdown-background) px-2 py-1 text-sm text-(--vscode-dropdown-foreground)"
						id="utility-model-provider"
						value={provider}
						onChange={(event) => handleProviderChange(event.target.value as ApiProvider)}>
						{ALL_PROVIDERS.map((candidate) => (
							<option key={candidate} value={candidate}>
								{getProviderLabel(candidate)}
							</option>
						))}
					</select>
				</label>
				<ModelAutocomplete
					label="Model"
					models={models}
					onChange={handleModelChange}
					placeholder="Search or enter any model ID..."
					selectedModelId={selection?.modelId}
				/>
			</div>

			<div className="space-y-2 border-t border-(--vscode-panel-border) pt-4">
				<div className="text-sm font-medium">Use utility model for</div>
				{USE_CASES.map(({ field, label, description }) => (
					<div key={field}>
						<VSCodeCheckbox
							aria-label={label}
							checked={
								field === "utilityModelUseCondense"
									? utilityModelUseCondense
									: field === "utilityModelUseNewTask"
										? utilityModelUseNewTask
										: field === "utilityModelUseGenerateCommitMessage"
											? utilityModelUseGenerateCommitMessage
											: utilityModelUsePermissionHandling
							}
							onChange={(event: any) => updateSetting(field, event.target.checked === true)}>
							{label}
						</VSCodeCheckbox>
						<p className="ml-6 mt-0.5 text-xs text-description">{description}</p>
					</div>
				))}
			</div>

			{utilityModelUsePermissionHandling && (
				<div className="space-y-2 rounded border border-(--vscode-panel-border) p-3">
					<label className="block text-sm font-medium" htmlFor="utility-permission-policy">
						Permission policy
					</label>
					<textarea
						aria-label="Permission policy"
						className="min-h-24 w-full resize-y rounded-sm border border-(--vscode-input-border) bg-(--vscode-input-background) px-2 py-1 text-sm text-(--vscode-input-foreground)"
						id="utility-permission-policy"
						placeholder="Allow file edits in this repository. Ask before network calls. Never allow operations in secrets/."
						value={permissionPolicy}
						onChange={(event) => setPermissionPolicy(event.target.value)}
						onBlur={() => void persistPermissionPolicy()}
					/>
					<p className="text-xs text-description">{SETTINGS_HELP.utilityPermissionFallback}</p>
					{permissionPolicySaving && <p className="text-xs text-description">Saving permission policy...</p>}
					{permissionPolicySaveError && (
						<p className="text-xs text-(--vscode-errorForeground)">
							Permission policy was not saved. Blur the field to retry.
						</p>
					)}
					{permissionPolicy.trim() === "" && (
						<p className="text-xs text-(--vscode-editorWarning-foreground)">
							Add a policy before automatic permission handling can run.
						</p>
					)}
				</div>
			)}

			{anyUseCaseEnabled && !selection?.modelId && (
				<p className="rounded border border-(--vscode-inputValidation-warningBorder) px-2 py-1 text-xs text-(--vscode-editorWarning-foreground)">
					Select a Utility Model provider and model before this use case can run.
				</p>
			)}

			<p className="text-xs text-description">{SETTINGS_HELP.utilityDisclosure}</p>
		</div>
	)
}

export default UtilityModelSelection

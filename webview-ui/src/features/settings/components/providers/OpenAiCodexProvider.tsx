import { modelSupportsInferenceSpeed, openAiCodexModels } from "@shared/api"
import { Mode } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dirac/common"
import { useEffect, useRef, useState } from "react"
import { useAppStore } from "@/app/store/appStore"
import {
	getModeSpecificFields,
	normalizeApiConfiguration,
	supportsReasoningEffortForModelId,
} from "@/features/settings/components/utils/providerUtils"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { ModelsServiceClient } from "@/shared/api/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import InferenceSpeedSelector from "../InferenceSpeedSelector"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { OpenAiCodexAccountCard } from "./openai-codex/OpenAiCodexAccountCard"
import { OpenAiCodexUsagePanel } from "./openai-codex/OpenAiCodexUsagePanel"
import { getOpenAiCodexQuotaFetchedAt, OPENAI_CODEX_USAGE_LAZY_REFRESH_MS } from "./openai-codex/formatOpenAiCodexUsage"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/** ChatGPT-login Codex provider settings. Subscription quota remains separate from task token usage. */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const {
		apiConfiguration,
		openAiCodexIsAuthenticated,
		openAiCodexEmail,
		openAiCodexUsage,
		openAiCodexUsageRefreshing,
		openAiCodexUsageRefreshError,
		refreshOpenAiCodexUsage,
	} = useSettingsStore()
	const navigateToSettings = useAppStore((state) => state.navigateToSettings)
	const [authError, setAuthError] = useState<string>()
	const lazyRefreshRequested = useRef(false)

	useEffect(() => {
		if (!openAiCodexIsAuthenticated) {
			lazyRefreshRequested.current = false
			return
		}
		if (lazyRefreshRequested.current) return

		const now = Date.now()
		const quotaFetchedAt = getOpenAiCodexQuotaFetchedAt(openAiCodexUsage)
		const activityFetchedAt = openAiCodexUsage?.activityFetchedAt
		const quotaIsFresh = quotaFetchedAt !== undefined && now - quotaFetchedAt <= OPENAI_CODEX_USAGE_LAZY_REFRESH_MS
		const activityIsFresh = activityFetchedAt !== undefined && now - activityFetchedAt <= OPENAI_CODEX_USAGE_LAZY_REFRESH_MS
		if (quotaIsFresh && activityIsFresh) return

		lazyRefreshRequested.current = true
		void refreshOpenAiCodexUsage(false)
	}, [openAiCodexIsAuthenticated, openAiCodexUsage, refreshOpenAiCodexUsage])


	const handleSignOut = async () => {
		setAuthError(undefined)
		try {
			await ModelsServiceClient.signOutOpenAiCodex(EmptyRequest.create({}))
		} catch (error) {
			setAuthError(error instanceof Error ? error.message : "Could not sign out from ChatGPT")
		}
	}

	const { handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const configuredInferenceSpeed = getModeSpecificFields(apiConfiguration, currentMode).inferenceSpeed
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, selectedModelInfo)
	const setSelectedModel = (modelId: string) => {
		if (modelSupportsInferenceSpeed("openai-codex", modelId) || configuredInferenceSpeed !== "fast") {
			return handleModeFieldChange({ plan: "planModeApiModelId", act: "actModeApiModelId" }, modelId, currentMode)
		}
		return handleModeFieldsChange(
			{
				apiModelId: { plan: "planModeApiModelId", act: "actModeApiModelId" },
				inferenceSpeed: { plan: "planModeInferenceSpeed", act: "actModeInferenceSpeed" },
			},
			{ apiModelId: modelId, inferenceSpeed: "default" },
			currentMode,
		)
	}

	return (
		<div className="space-y-3">
			<OpenAiCodexAccountCard
				authError={authError}
				email={openAiCodexEmail}
				isAuthenticated={openAiCodexIsAuthenticated}
				onSignOut={() => void handleSignOut()}
				planType={openAiCodexUsage?.planType}
			/>

			{openAiCodexIsAuthenticated && (
				<OpenAiCodexUsagePanel
					isPopup={isPopup}
					isRefreshing={openAiCodexUsageRefreshing}
					onRefresh={refreshOpenAiCodexUsage}
					onViewDetails={isPopup ? () => navigateToSettings("models-api") : undefined}
					refreshError={openAiCodexUsageRefreshError}
					snapshot={openAiCodexUsage}
				/>
			)}

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiCodexModels}
						onChange={(event: any) => setSelectedModel(event.target.value)}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}
					<InferenceSpeedSelector
						currentMode={currentMode}
						description="Fast provides higher Codex throughput and consumes subscription credits at a premium rate."
						supportsFastMode={selectedModelInfo.supportsFastMode === true}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

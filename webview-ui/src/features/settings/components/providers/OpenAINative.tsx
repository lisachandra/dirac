import { modelSupportsInferenceSpeed, openAiNativeModels } from "@shared/api"
import { Mode } from "@shared/ExtensionMessage"
import {
	getModeSpecificFields,
	normalizeApiConfiguration,
	supportsReasoningEffortForModelId,
} from "@/features/settings/components/utils/providerUtils"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { ApiKeyField } from "../common/ApiKeyField"
import InferenceSpeedSelector from "../InferenceSpeedSelector"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAINativeProvider component
 */
interface OpenAINativeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI (native) provider configuration component
 */
export const OpenAINativeProvider = ({ showModelOptions, isPopup, currentMode }: OpenAINativeProviderProps) => {
	const { apiConfiguration } = useSettingsStore()
	const { handleFieldChange, handleModeFieldChange, handleModeFieldsChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const configuredInferenceSpeed = getModeSpecificFields(apiConfiguration, currentMode).inferenceSpeed
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, selectedModelInfo)
	const setSelectedModel = (modelId: string) => {
		if (modelSupportsInferenceSpeed("openai-native", modelId) || configuredInferenceSpeed !== "fast") {
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
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.openAiNativeApiKey || ""}
				onChange={(value: string) => handleFieldChange("openAiNativeApiKey", value)}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiNativeModels}
						onChange={(event: any) => setSelectedModel(event.target.value)}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}
					<InferenceSpeedSelector
						currentMode={currentMode}
						description="Fast uses OpenAI priority processing at premium API pricing. Standard explicitly disables it."
						supportsFastMode={selectedModelInfo.supportsFastMode === true}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

import {
	DEFAULT_OPENAI_REASONING_EFFORT,
	isOpenaiReasoningEffort,
	Mode,
	OPENAI_REASONING_EFFORT_LABELS,
	OPENAI_REASONING_EFFORT_OPTIONS,
	OpenaiReasoningEffort,
} from "@shared/ExtensionMessage"
import { memo } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { Label } from "@/shared/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	defaultEffort?: OpenaiReasoningEffort
}

const ReasoningEffortSelector = ({
	currentMode,
	label = "Reasoning Effort",
	description = "Higher effort improves depth, but uses more tokens.",
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = DEFAULT_OPENAI_REASONING_EFFORT,
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useSettingsStore()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const selectedEffort =
		isOpenaiReasoningEffort(modeFields.reasoningEffort) && allowedEfforts.includes(modeFields.reasoningEffort)
			? modeFields.reasoningEffort
			: allowedEfforts.includes(defaultEffort)
				? defaultEffort
				: allowedEfforts[0]

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				onValueChange={(value) =>
					handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, value, currentMode)
				}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{allowedEfforts.map((effort) => (
						<SelectItem key={effort} value={effort}>
							{OPENAI_REASONING_EFFORT_LABELS[effort]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description}
			</p>
		</div>
	)
}

export default memo(ReasoningEffortSelector)

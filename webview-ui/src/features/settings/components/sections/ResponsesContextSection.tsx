import type { ApiProvider } from "@shared/api"
import { Mode } from "@shared/ExtensionMessage"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { AutoCondenseContextLimitSetting } from "../AutoCondenseContextLimitSetting"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { updateSetting } from "../utils/settingsHandlers"

interface ResponsesContextSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ResponsesContextSection = ({ renderSectionHeader }: ResponsesContextSectionProps) => {
	const { apiConfiguration, lowVerbosityEnabled, mode, useAutoCondense } = useSettingsStore()
	const { selectedProvider } = normalizeApiConfiguration(apiConfiguration, mode as Mode)
	return (
		<div className="mb-2">
			{renderSectionHeader("responses-context")}
			<Section>
				<PreferredLanguageSetting />
				<div id="low-verbosity-responses">
					<VSCodeCheckbox
						checked={lowVerbosityEnabled}
						onChange={(event: any) => updateSetting("lowVerbosityEnabled", event.target.checked === true)}>
						Low-verbosity responses
					</VSCodeCheckbox>
					<p className="ml-6 mt-1 text-xs text-description">
						Keep responses concise while preserving decisions, caveats, and verification.
					</p>
				</div>
				<div id="auto-condense-conversations">
					<VSCodeCheckbox
						checked={useAutoCondense}
						onChange={(event: any) => updateSetting("useAutoCondense", event.target.checked === true)}>
						Auto-condense conversations
					</VSCodeCheckbox>
					<p className="ml-6 mt-1 text-xs text-description">
						Summarize older conversation history as the context window fills.
					</p>
				</div>
				{selectedProvider && (
					<AutoCondenseContextLimitSetting key={selectedProvider} providerId={selectedProvider as ApiProvider} />
				)}
				<p className="text-xs text-description">
					This section controls whether and when condensing occurs. Utility Model controls which model performs it when
					that use case is enabled.
				</p>
			</Section>
		</div>
	)
}

export default ResponsesContextSection

import { useSettingsStore } from "@/features/settings/store/settingsStore"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"
import ToolTogglePanel from "./ToolTogglePanel"
import { Switch } from "@/shared/ui/switch"

interface ToolsSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ToolsSettingsSection = ({ renderSectionHeader }: ToolsSettingsSectionProps) => {
	const { diracWebToolsEnabled, hooksEnabled } = useSettingsStore()
	return (
		<div className="mb-2">
			{renderSectionHeader("tools")}
			<Section>
				<div className="rounded border border-(--vscode-widget-border) p-3">
					<div className="border-b border-(--vscode-panel-border) py-3" id="web-search-fetch">
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm font-medium">Web search & fetch</span>
							<Switch
								aria-label="Web search & fetch"
								checked={diracWebToolsEnabled.user}
								disabled={!diracWebToolsEnabled.featureFlag}
								onCheckedChange={(checked) => updateSetting("diracWebToolsEnabled", checked)}
								size="lg"
							/>
						</div>
						<p className="mb-0 mt-1 text-xs text-description">
							Allow Dirac to search the web and retrieve page content. This is distinct from interactive browser
							control.
						</p>
					</div>
					<div className="py-3" id="hooks">
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm font-medium">Hooks</span>
							<Switch
								aria-label="Hooks"
								checked={hooksEnabled}
								onCheckedChange={(checked) => updateSetting("hooksEnabled", checked)}
								size="lg"
							/>
						</div>
						<p className="mb-0 mt-1 text-xs text-(--vscode-editorWarning-foreground)">
							Run configured lifecycle and tool hooks during task execution. Enabled hooks may execute local
							scripts.
						</p>
					</div>
				</div>
			</Section>
			<ToolTogglePanel renderSectionHeader={() => null} />
		</div>
	)
}

export default ToolsSettingsSection

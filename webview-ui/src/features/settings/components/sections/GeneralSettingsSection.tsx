import { SETTINGS_HELP } from "@shared/settings-presentation"
import { VSCodeCheckbox, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip"
import { Button } from "@/shared/ui/button"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	onResetState?: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
	version?: string
}

const GeneralSettingsSection = ({ onResetState, renderSectionHeader, version }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings, writePromptMetadataEnabled, writePromptMetadataDirectory, setShowWelcome } =
		useSettingsStore()
	const isTelemetryRemoteLocked = remoteConfigSettings?.telemetrySetting !== undefined
	const effectiveTelemetrySetting = remoteConfigSettings?.telemetrySetting ?? telemetrySetting
	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<h3 className="mb-0 text-sm font-medium">Privacy & data</h3>
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-2" tabIndex={isTelemetryRemoteLocked ? 0 : undefined}>
							<VSCodeCheckbox
								checked={effectiveTelemetrySetting !== "disabled"}
								disabled={isTelemetryRemoteLocked}
								onChange={(event: any) =>
									updateSetting("telemetrySetting", event.target.checked === true ? "enabled" : "disabled")
								}>
								Error & usage reporting
							</VSCodeCheckbox>
							{isTelemetryRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
						</div>
					</TooltipTrigger>
					<TooltipContent hidden={!isTelemetryRemoteLocked}>{SETTINGS_HELP.managedSetting}</TooltipContent>
				</Tooltip>
				<p className="ml-6 mt-0 text-sm text-description">
					Help improve Dirac by sending usage data and error reports. No code, prompts, or personal information are
					sent.
				</p>

				<div id="prompt-metadata-artifacts">
					<VSCodeCheckbox
						checked={writePromptMetadataEnabled ?? false}
						onChange={(event: any) => updateSetting("writePromptMetadataEnabled", event.target.checked === true)}>
						Prompt metadata artifacts
					</VSCodeCheckbox>
					<p className="ml-6 mt-1 text-xs text-description">
						Save the system prompt, tool definitions, and conversation history for each request to local Markdown
						files.
					</p>
					<p className="ml-6 mt-1 text-xs text-(--vscode-editorWarning-foreground)">{SETTINGS_HELP.promptArtifacts}</p>
					{writePromptMetadataEnabled && (
						<div className="ml-6">
							<label className="mb-1 block font-medium" htmlFor="prompt-artifacts-directory">
								Artifacts directory
							</label>
							<VSCodeTextField
								className="w-full"
								id="prompt-artifacts-directory"
								onChange={(event: any) => updateSetting("writePromptMetadataDirectory", event.target.value)}
								placeholder=".dirac-prompt-artifacts"
								value={writePromptMetadataDirectory || ""}
							/>
							<p className="text-xs text-description">Relative paths resolve from the workspace root.</p>
						</div>
					)}
				</div>

				<h3 className="mb-0 mt-4 text-sm font-medium">Help & support</h3>
				<p className="m-0">
					<VSCodeLink href="https://dirac.run/docs/">Documentation</VSCodeLink>
					{" • "}
					<VSCodeLink href="https://discord.gg/wcYTx9BGea">Discord</VSCodeLink>
					{" • "}
					<VSCodeLink href="https://github.com/dirac-run/dirac/issues">Support</VSCodeLink>
				</p>

				<h3 className="mb-0 mt-4 text-sm font-medium" id="about">
					About
				</h3>
				<p className="m-0">Dirac v{version}</p>

				{onResetState && (
					<div className="rounded border border-(--vscode-inputValidation-errorBorder) p-3" id="advanced-diagnostics">
						<h3 className="mt-0 text-sm font-medium">Advanced / diagnostics</h3>
						<div className="flex flex-wrap gap-2">
							<Button onClick={() => void onResetState()} variant="error">
								Reset workspace state
							</Button>
							<Button onClick={() => void onResetState(true)} variant="error">
								Reset global state
							</Button>
							<Button
								onClick={() =>
									void import("@/shared/api/grpc-client").then(({ StateServiceClient }) =>
										StateServiceClient.setWelcomeViewCompleted({
											value: false,
										}).finally(() => setShowWelcome(true)),
									)
								}
								variant="secondary">
								Reset onboarding state
							</Button>
						</div>
						<p className="mb-0 mt-2 text-xs text-(--vscode-errorForeground)">
							Resetting global state also clears secret storage. These actions cannot be undone.
						</p>
					</div>
				)}
			</Section>
		</div>
	)
}

export default GeneralSettingsSection

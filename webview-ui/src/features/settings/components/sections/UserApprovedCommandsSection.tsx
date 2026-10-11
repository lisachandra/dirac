import type { UserApprovedCommand, UserApprovedCommandMatch } from "@shared/UserApprovedCommand"
import { SETTINGS_HELP } from "@shared/settings-presentation"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import Section from "../Section"
import { persistSetting } from "../utils/settingsHandlers"

interface UserApprovedCommandsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const UserApprovedCommandsSection = ({ renderSectionHeader }: UserApprovedCommandsSectionProps) => {
	const userApprovedCommands = useSettingsStore((state) => state.userApprovedCommands)
	const [command, setCommand] = useState("")
	const [match, setMatch] = useState<UserApprovedCommandMatch>("exact")
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const mutationInProgress = useRef(false)
	const exampleCommand = command.trim() || "npm test"
	const commandWithArgumentsExample = command.trim() ? `${command.trim()} --example` : "npm test -- --watch"

	useEffect(() => {
		if (editingIndex !== null && editingIndex >= userApprovedCommands.length) cancelEdit()
	}, [editingIndex, userApprovedCommands.length])

	useEffect(() => {
		if (editingIndex === null) return
		document.getElementById("user-approved-command-input")?.focus()
	}, [editingIndex])

	const cancelEdit = () => {
		setCommand("")
		setMatch("exact")
		setEditingIndex(null)
		setError(null)
	}

	const persistCommands = async (commands: UserApprovedCommand[]): Promise<boolean> => {
		if (mutationInProgress.current) return false
		mutationInProgress.current = true
		setIsSaving(true)
		setError(null)
		try {
			await persistSetting("userApprovedCommands", { commands })
			useSettingsStore.getState().setSettings({ userApprovedCommands: commands })
			return true
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not save approved commands.")
			return false
		} finally {
			mutationInProgress.current = false
			setIsSaving(false)
		}
	}

	const save = async () => {
		const trimmedCommand = command.trim()
		if (!trimmedCommand) {
			setError("Enter a command.")
			return
		}
		if (trimmedCommand.includes("\n") || trimmedCommand.includes("\r")) {
			setError("Commands must be a single line.")
			return
		}

		const entry: UserApprovedCommand = { command: trimmedCommand, match }
		const duplicate = userApprovedCommands.some(
			(candidate, index) =>
				index !== editingIndex && candidate.command === entry.command && candidate.match === entry.match,
		)
		if (duplicate) {
			setError("That command and approval scope are already listed.")
			return
		}

		const next = [...userApprovedCommands]
		if (editingIndex === null) next.push(entry)
		else next[editingIndex] = entry
		if (await persistCommands(next)) cancelEdit()
	}

	const edit = (entry: UserApprovedCommand, index: number) => {
		if (editingIndex !== null) return
		setCommand(entry.command)
		setMatch(entry.match)
		setEditingIndex(index)
		setError(null)
	}

	const remove = async (index: number) => {
		if (editingIndex !== null) return
		await persistCommands(userApprovedCommands.filter((_, candidateIndex) => candidateIndex !== index))
	}

	return (
		<div id="user-approved-commands">
			{renderSectionHeader("user-approved-commands")}
			<Section>
				<p className="m-0 text-sm text-(--vscode-descriptionForeground)">
					Matching commands bypass confirmation and built-in command safety validation; configured permission rules
					still apply.
				</p>

				<div className="flex flex-col gap-2 rounded border border-(--vscode-widget-border) p-3">
					<label className="font-medium" htmlFor="user-approved-command-input">
						Command
					</label>
					<VSCodeTextField
						className="w-full font-mono"
						disabled={isSaving}
						id="user-approved-command-input"
						onInput={(event) => {
							setCommand((event.target as HTMLInputElement).value)
							setError(null)
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !isSaving) void save()
						}}
						placeholder="npm test"
						value={command}
					/>

					<fieldset className="flex flex-col gap-2" disabled={isSaving}>
						<legend className="mb-1 font-medium">Approval scope</legend>
						<label
							className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${match === "exact"
									? "border-(--vscode-focusBorder) bg-(--vscode-list-hoverBackground)"
									: "border-(--vscode-widget-border)"
								}`}>
							<input
								checked={match === "exact"}
								className="mt-0.5 shrink-0"
								name="user-approved-command-match"
								onChange={() => setMatch("exact")}
								type="radio"
							/>
							<span className="min-w-0">
								<span className="flex flex-wrap items-center gap-2">
									<span className="font-medium">Exact command only</span>
									<span className="rounded bg-(--vscode-badge-background) px-1.5 py-0.5 text-xs text-(--vscode-badge-foreground)">
										Safer
									</span>
								</span>
								<span className="mt-1 block text-xs text-(--vscode-descriptionForeground)">
									Approves <code className="break-all">{exampleCommand}</code>, but not{" "}
									<code className="break-all">{commandWithArgumentsExample}</code>.
								</span>
							</span>
						</label>
						<label
							className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${match === "prefix"
									? "border-(--vscode-focusBorder) bg-(--vscode-list-hoverBackground)"
									: "border-(--vscode-widget-border)"
								}`}>
							<input
								checked={match === "prefix"}
								className="mt-0.5 shrink-0"
								name="user-approved-command-match"
								onChange={() => setMatch("prefix")}
								type="radio"
							/>
							<span className="min-w-0">
								<span className="font-medium">Command with any arguments</span>
								<span className="mt-1 block text-xs text-(--vscode-descriptionForeground)">
									Approves both <code className="break-all">{exampleCommand}</code> and{" "}
									<code className="break-all">{commandWithArgumentsExample}</code>.
								</span>
							</span>
						</label>
					</fieldset>
					{match === "prefix" && (
						<p className="m-0 text-xs text-(--vscode-editorWarning-foreground)">
							{SETTINGS_HELP.approvedCommandPrefix}
						</p>
					)}
					<p className="m-0 text-xs text-(--vscode-descriptionForeground)">{SETTINGS_HELP.approvedCommandMatching}</p>
					{error && <p className="m-0 text-xs text-(--vscode-errorForeground)">{error}</p>}
					<div className="flex justify-end gap-2">
						{editingIndex !== null && (
							<VSCodeButton appearance="secondary" disabled={isSaving} onClick={cancelEdit}>
								Cancel
							</VSCodeButton>
						)}
						<VSCodeButton disabled={isSaving} onClick={() => void save()}>
							{isSaving ? "Saving…" : editingIndex === null ? "Add command" : "Save command"}
						</VSCodeButton>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<h3 className="m-0 text-sm font-medium">Approved commands</h3>
					{userApprovedCommands.length === 0 ? (
						<p className="m-0 text-sm text-(--vscode-descriptionForeground)">No user-approved commands.</p>
					) : (
						userApprovedCommands.map((entry, index) => (
							<div
								className="flex items-center gap-3 rounded border border-(--vscode-widget-border) px-3 py-2"
								key={`${entry.match}:${entry.command}`}>
								<code className="min-w-0 flex-1 break-all">{entry.command}</code>
								<span className="shrink-0 text-xs text-(--vscode-descriptionForeground)">
									{entry.match === "exact" ? "Exact only" : "Any arguments"}
								</span>
								<VSCodeButton
									appearance="secondary"
									disabled={isSaving || editingIndex !== null}
									onClick={() => edit(entry, index)}>
									Edit
								</VSCodeButton>
								<VSCodeButton
									appearance="secondary"
									disabled={isSaving || editingIndex !== null}
									onClick={() => void remove(index)}>
									Delete
								</VSCodeButton>
							</div>
						))
					)}
				</div>
			</Section>
		</div>
	)
}

export default UserApprovedCommandsSection

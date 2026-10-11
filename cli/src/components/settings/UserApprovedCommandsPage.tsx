import type { UserApprovedCommand, UserApprovedCommandMatch } from "@shared/UserApprovedCommand"
import { SETTINGS_HELP } from "@shared/settings-presentation"
import { Box, Text, useInput } from "ink"
import { useEffect, useState } from "react"
// biome-ignore lint/correctness/noUnusedImports: React is needed for JSX at runtime
import React from "react"
import { theme } from "../../constants/theme"
import { useScrollableList } from "../../hooks/useScrollableList"
import { shouldIgnoreTerminalInput } from "../../utils/input"

interface UserApprovedCommandsPageProps {
	commands: UserApprovedCommand[]
	isActive: boolean
	maxRows: number
	onChange: (commands: UserApprovedCommand[]) => Promise<boolean>
	onClose: () => void
}

export const UserApprovedCommandsPage = ({ commands, isActive, maxRows, onChange, onClose }: UserApprovedCommandsPageProps) => {
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [command, setCommand] = useState("")
	const [match, setMatch] = useState<UserApprovedCommandMatch>("exact")
	const [error, setError] = useState<string | null>(null)
	const itemCount = commands.length + 1
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		itemCount,
		selectedIndex,
		Math.max(1, maxRows - 8),
	)
	const visibleCommands = commands.slice(visibleStart, Math.min(commands.length, visibleStart + visibleCount))
	const showAddCommand = visibleStart + visibleCount > commands.length
	const selectedCommand = commands[selectedIndex]

	useEffect(() => {
		setSelectedIndex((current) => Math.min(current, itemCount - 1))
	}, [itemCount])

	const startAdd = () => {
		setEditingIndex(-1)
		setCommand("")
		setMatch("exact")
		setError(null)
	}

	const startEdit = (index: number) => {
		const entry = commands[index]
		if (!entry) return
		setEditingIndex(index)
		setCommand(entry.command)
		setMatch(entry.match)
		setError(null)
	}

	const cancelEdit = () => {
		setEditingIndex(null)
		setCommand("")
		setMatch("exact")
		setError(null)
	}

	const save = async () => {
		const trimmed = command.trim()
		if (!trimmed) {
			setError("Enter a command.")
			return
		}
		if (trimmed.includes("\n") || trimmed.includes("\r")) {
			setError("Commands must be a single line.")
			return
		}
		const duplicate = commands.some(
			(entry, index) => index !== editingIndex && entry.command === trimmed && entry.match === match,
		)
		if (duplicate) {
			setError("That command and approval scope are already listed.")
			return
		}
		const next = [...commands]
		if (editingIndex === -1) next.push({ command: trimmed, match })
		else if (editingIndex !== null) next[editingIndex] = { command: trimmed, match }
		if (await onChange(next)) cancelEdit()
	}

	const remove = async (index: number) => {
		const saved = await onChange(commands.filter((_, commandIndex) => commandIndex !== index))
		if (!saved) setError("Could not save approved commands.")
	}

	useInput(
		(input, key) => {
			if (!isActive || shouldIgnoreTerminalInput(input, key)) return
			if (editingIndex !== null) {
				if (key.escape) cancelEdit()
				else if (key.return) void save()
				else if (key.tab) setMatch((current) => (current === "exact" ? "prefix" : "exact"))
				else if (key.backspace || key.delete) setCommand((current) => current.slice(0, -1))
				else if (input && !key.ctrl && !key.meta) {
					setCommand((current) => current + input)
					setError(null)
				}
				return
			}

			if (key.escape) onClose()
			else if (key.upArrow) setSelectedIndex((current) => Math.max(0, current - 1))
			else if (key.downArrow) setSelectedIndex((current) => Math.min(itemCount - 1, current + 1))
			else if (input === "a" || ((key.return || key.tab) && selectedIndex === commands.length)) startAdd()
			else if (input === "e" || key.return || key.tab) startEdit(selectedIndex)
			else if ((input === "d" || key.delete) && commands[selectedIndex]) void remove(selectedIndex)
		},
		{ isActive },
	)

	if (editingIndex !== null) {
		return (
			<Box flexDirection="column">
				<Text bold>{editingIndex === -1 ? "Add user-approved command" : "Edit user-approved command"}</Text>
				<Text>
					Command: <Text color={theme.primary}>{command || " "}</Text>
				</Text>
				<Text>
					Approval scope:{" "}
					<Text color={theme.primary}>{match === "exact" ? "Exact command only" : "Command with any arguments"}</Text>
				</Text>
				<Text color={theme.muted}>
					{match === "exact"
						? "This entry approves only the complete command. Added arguments are not covered."
						: "This entry also approves the same command with any additional arguments."}
				</Text>
				{match === "prefix" && <Text color={theme.warning}>{SETTINGS_HELP.approvedCommandPrefix}</Text>}
				<Text color={theme.muted}>{SETTINGS_HELP.approvedCommandMatching}</Text>
				{error && <Text color={theme.error}>{error}</Text>}
				<Text color={theme.muted}>Type command · Tab change scope · Enter save · Esc cancel</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column">
			<Text color={theme.muted}>
				Use care: Matching commands run without confirmation and bypass Dirac’s built-in command safety validation.
				Configured permission rules still apply.
			</Text>
			{showTopIndicator && <Text color={theme.muted}>… {visibleStart} more above</Text>}
			{visibleCommands.map((entry, index) => {
				const actualIndex = visibleStart + index
				return (
					<Text key={`${entry.match}:${entry.command}`}>
						<Text
							bold={selectedIndex === actualIndex}
							color={selectedIndex === actualIndex ? theme.primary : theme.subtle}>
							{selectedIndex === actualIndex ? "❯ " : "  "}
						</Text>
						<Text bold={selectedIndex === actualIndex}>{entry.command}</Text>
						<Text color={theme.muted}> · {entry.match === "exact" ? "Exact only" : "Any arguments"}</Text>
					</Text>
				)
			})}
			{showAddCommand && (
				<Text
					bold={selectedIndex === commands.length}
					color={selectedIndex === commands.length ? theme.primary : theme.text}>
					{selectedIndex === commands.length ? "❯ " : "  "}Add command
				</Text>
			)}
			{showBottomIndicator && <Text color={theme.muted}>… {itemCount - visibleStart - visibleCount} more below</Text>}
			{selectedCommand?.match === "prefix" && <Text color={theme.warning}>{SETTINGS_HELP.approvedCommandPrefix}</Text>}
			<Text color={theme.muted}>{SETTINGS_HELP.approvedCommandMatching}</Text>
			{error && <Text color={theme.error}>{error}</Text>}
		</Box>
	)
}

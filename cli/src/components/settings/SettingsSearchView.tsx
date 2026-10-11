import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is required by the CLI JSX factory.
import React, { useEffect, useMemo, useState } from "react"
import { theme } from "../../constants/theme"
import { useStdinContext } from "../../context/StdinContext"
import { useScrollableList } from "../../hooks/useScrollableList"
import { shouldIgnoreTerminalInput } from "../../utils/input"
import type { ListItem, SettingsSearchResult } from "./types"

interface SettingsSearchViewProps {
	results: SettingsSearchResult[]
	isActive: boolean
	helpItem: ListItem | null
	maxRows: number
	onCancel: () => void
	onCloseHelp: () => void
	onSelect: (result: SettingsSearchResult) => void
	onHelp: (result: SettingsSearchResult) => void
}

export const SettingsSearchView = ({
	results,
	isActive,
	helpItem,
	maxRows,
	onCancel,
	onCloseHelp,
	onSelect,
	onHelp,
}: SettingsSearchViewProps) => {
	const { isRawModeSupported } = useStdinContext()
	const [query, setQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase()
		if (!normalized) return results
		const terms = normalized.split(/\s+/)
		return results.filter((result) => terms.every((term) => result.searchText.includes(term)))
	}, [query, results])
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		filtered.length,
		selectedIndex,
		Math.max(1, maxRows - 5),
	)

	useEffect(() => setSelectedIndex(0), [query])
	useEffect(() => {
		setSelectedIndex((current) => Math.max(0, Math.min(current, filtered.length - 1)))
	}, [filtered.length])

	useInput(
		(input, key) => {
			if (!isActive || shouldIgnoreTerminalInput(input, key)) return
			if (helpItem) {
				if (key.escape || input === "?") onCloseHelp()
				return
			}
			if (key.escape) onCancel()
			else if (key.upArrow) setSelectedIndex((current) => Math.max(0, current - 1))
			else if (key.downArrow) setSelectedIndex((current) => Math.min(filtered.length - 1, current + 1))
			else if (key.return && filtered[selectedIndex]) onSelect(filtered[selectedIndex])
			else if (input === "?" && filtered[selectedIndex]) onHelp(filtered[selectedIndex])
			else if (key.backspace || key.delete) setQuery((current) => current.slice(0, -1))
			else if (input && !key.ctrl && !key.meta && input.length === 1) setQuery((current) => current + input)
		},
		{ isActive: isRawModeSupported && isActive },
	)

	const visible = filtered.slice(visibleStart, visibleStart + visibleCount)
	const selected = filtered[selectedIndex]
	if (helpItem) {
		return (
			<Box flexDirection="column">
				<Text bold color={theme.strongText}>
					{helpItem.label || "Setting help"}
				</Text>
				{helpItem.description && <Text color={theme.text}>{helpItem.description}</Text>}
				{helpItem.value !== "" && !helpItem.description && <Text color={theme.text}>{String(helpItem.value)}</Text>}
				{helpItem.expandedHelp && <Text color={theme.muted}>{helpItem.expandedHelp}</Text>}
				{helpItem.persistentHelp && (
					<Text color={helpItem.helpTone === "error" ? theme.error : theme.warning}>{helpItem.persistentHelp}</Text>
				)}
			</Box>
		)
	}
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={theme.muted}>Search settings: </Text>
				<Text color={theme.text}>{query}</Text>
				<Text backgroundColor={theme.cursorBg} color={theme.cursorText}>
					{" "}
				</Text>
			</Box>
			{showTopIndicator && <Text color={theme.muted}>… {visibleStart} more above</Text>}
			{visible.map((result, index) => {
				const actualIndex = visibleStart + index
				const isSelected = actualIndex === selectedIndex
				return (
					<Text key={result.id}>
						<Text bold color={isSelected ? theme.primary : theme.subtle}>
							{isSelected ? "❯ " : "  "}
						</Text>
						<Text bold={isSelected} color={isSelected ? theme.strongText : theme.text}>
							{result.item.label || String(result.item.value)}
						</Text>
						<Text color={theme.muted}> · {result.destinationLabel}</Text>
					</Text>
				)
			})}
			{showBottomIndicator && <Text color={theme.muted}>… {filtered.length - visibleStart - visibleCount} more below</Text>}
			{filtered.length === 0 && <Text color={theme.muted}>No settings match “{query}”.</Text>}
			{selected?.item.description && (
				<Box marginTop={1}>
					<Text color={theme.muted}>{selected.item.description}</Text>
				</Box>
			)}
		</Box>
	)
}

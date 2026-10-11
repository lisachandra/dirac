import { Box, Text } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is required by the CLI JSX factory.
import React from "react"
import { theme } from "../../constants/theme"
import { useScrollableList } from "../../hooks/useScrollableList"
import type { CliSettingsDestination } from "./constants"

interface SettingsHomeViewProps {
	destinations: CliSettingsDestination[]
	selectedIndex: number
	maxRows: number
}

export const SettingsHomeView = ({ destinations, selectedIndex, maxRows }: SettingsHomeViewProps) => {
	const showQuestion = maxRows >= 4
	const rowsPerDestination = showQuestion ? 2 : 1
	const listRows = Math.max(1, Math.floor((maxRows - 2) / rowsPerDestination))
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		destinations.length,
		selectedIndex,
		listRows,
	)
	const visible = destinations.slice(visibleStart, visibleStart + visibleCount)
	return (
		<Box flexDirection="column">
			{showTopIndicator && <Text color={theme.muted}>… {visibleStart} more above</Text>}
			{visible.map((destination, index) => {
				const actualIndex = visibleStart + index
				const selected = selectedIndex === actualIndex
				return (
					<Box flexDirection="column" key={destination.key}>
						<Text>
							<Text bold color={selected ? theme.primary : theme.subtle}>
								{selected ? "❯" : " "} {actualIndex + 1}{" "}
							</Text>
							<Text bold={selected} color={selected ? theme.strongText : theme.text}>
								{destination.label.padEnd(21)}
							</Text>
							<Text color={theme.muted}>{destination.description}</Text>
						</Text>
						{selected && showQuestion && (
							<Box marginLeft={5}>
								<Text color={theme.muted}>{destination.question}</Text>
							</Box>
						)}
					</Box>
				)
			})}
			{showBottomIndicator && (
				<Text color={theme.muted}>… {destinations.length - visibleStart - visibleCount} more below</Text>
			)}
		</Box>
	)
}

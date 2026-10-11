import { theme } from "../constants/theme"
/**
 * Reusable bottom panel component
 * Used for displaying contextual UI below the chat input (settings, etc.)
 */

import { Box, Text } from "ink"
import React, { ReactNode } from "react"
import { useTerminalSize } from "../hooks/useTerminalSize"

export interface PanelTab {
	key: string
	label: string
}

interface PanelProps {
	/** Label for the panel (e.g., "Settings") */
	label: string
	/** Optional tabs configuration */
	tabs?: PanelTab[]
	/** Current tab key - required when tabs are provided */
	currentTab?: string
	/** Whether currently in a subpage (shows "Esc to go back" and hides arrow key hint) */
	isSubpage?: boolean
	/** Panel content */
	children: ReactNode
	/** Optional stable shortcut/status footer. */
	footer?: ReactNode
}

export const Panel: React.FC<PanelProps> = ({ label, tabs, currentTab, isSubpage, children, footer }) => {
	const { columns } = useTerminalSize()
	const currentTabIndex = currentTab && tabs ? tabs.findIndex((t) => t.key === currentTab) : 0

	return (
		<Box borderColor={theme.border} borderStyle="round" flexDirection="column" width="100%">
			{/* Header */}
			<Box paddingLeft={1} paddingRight={1}>
				<Text bold color={theme.primary}>
					{label}
				</Text>
				<Text color={theme.muted}> (Esc to {isSubpage ? "go back" : "close"})</Text>
			</Box>

			{/* Tab bar if tabs are provided */}
			{tabs && tabs.length > 0 && (
				<Box flexWrap="wrap" paddingLeft={1} paddingRight={1}>
					{tabs.map((tab, idx) => {
						const isActive = idx === currentTabIndex
						return (
							<Text
								backgroundColor={isActive ? theme.selectionBg : undefined}
								bold={isActive}
								color={isActive ? theme.selectionText : theme.muted}
								key={tab.key}>
								{` ${tab.label} `}
							</Text>
						)
					})}
					{!isSubpage && <Text color={theme.muted}> (←/→)</Text>}
				</Box>
			)}

			{/* Separator line */}
			<Box>
				<Text color={theme.separator}>{"─".repeat(Math.max(columns - 2, 0))}</Text>
			</Box>

			{/* Content */}
			<Box flexDirection="column" paddingLeft={1} paddingRight={1}>
				{children}
			</Box>
			{footer && (
				<Box flexDirection="column">
					<Box>
						<Text color={theme.separator}>{"─".repeat(Math.max(columns - 2, 0))}</Text>
					</Box>
					<Box paddingLeft={1} paddingRight={1}>
						<Text color={theme.muted}>{footer}</Text>
					</Box>
				</Box>
			)}
		</Box>
	)
}

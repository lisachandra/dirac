import { theme } from "../constants/theme"
/**
 * History panel content for inline display in ChatView
 * Shows task history with search and keyboard navigation
 */

import { StringRequest } from "@shared/proto/dirac/common"
import { GetTaskHistoryRequest } from "@shared/proto/dirac/task"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Controller } from "@/core/controller"
import { getTaskHistory } from "@/core/controller/task/getTaskHistory"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { shouldIgnoreTerminalInput } from "../utils/input"
import { Panel } from "./Panel"
import { Logger } from "@/shared/services/Logger"
import { isGoalHistoryItem, type HistoryItem } from "@shared/HistoryItem"
import { historyItemFromProto } from "@shared/historyItemFromProto"

interface HistoryPanelContentProps {
	onClose: () => void
	onSelectTask: (taskId: string) => void
	controller: Controller
}

function formatRelativeDate(ts: number, now: number): string {
	const diff = now - ts
	const minutes = Math.floor(diff / 60000)
	const hours = Math.floor(diff / 3600000)
	const days = Math.floor(diff / 86400000)

	if (minutes < 1) return "just now"
	if (minutes < 60) return `${minutes}m ago`
	if (hours < 24) return `${hours}h ago`
	if (days < 7) return `${days}d ago`
	return new Date(ts).toLocaleDateString()
}

function formatCost(cost: number | undefined): string {
	if (cost === undefined) return "cost —"
	return `$${cost.toFixed(2)}`
}

export const HistoryPanelContent: React.FC<HistoryPanelContentProps> = ({ onClose, onSelectTask, controller }) => {
	const { isRawModeSupported } = useStdinContext()
	const { rows: terminalRows } = useTerminalSize()
	const [items, setItems] = useState<HistoryItem[]>([])
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [isOpeningTask, setIsOpeningTask] = useState(false)
	const [now, setNow] = useState(Date.now())

	// Calculate how many items fit in the panel
	// Panel has border (2) + header (1) + separator (1) + search bar (1) + hint (1) = 6 lines overhead
	// Each item takes 2 lines (text + metadata)
	const panelHeight = Math.min(terminalRows - 6, 20) // Cap panel height
	const itemHeight = 2
	const maxVisible = Math.max(1, Math.floor((panelHeight - 4) / itemHeight) - 2) // 4 lines for search + hints + padding

	// Load history
	useEffect(() => {
		let cancelled = false
		const timeout = setTimeout(async () => {
			setLoading(true)
			setLoadError(null)
			try {
				const request = GetTaskHistoryRequest.create({
					sortBy: "newest",
					searchQuery: searchQuery || undefined,
				})
				const result = await getTaskHistory(controller, request)
				if (cancelled) return
				setItems(result.tasks.map(historyItemFromProto))
			} catch (error) {
				Logger.error("Failed to load task history:", error)
				if (cancelled) return
				setItems([])
				setLoadError(error instanceof Error ? error.message : String(error))
			}
			if (!cancelled) setLoading(false)
		}, searchQuery ? 150 : 0)

		return () => {
			cancelled = true
			clearTimeout(timeout)
		}
	}, [controller, searchQuery])

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 60_000)
		return () => clearInterval(interval)
	}, [])

	// Reset selection when search changes
	useEffect(() => {
		setSelectedIndex(0)
	}, [searchQuery])

	useEffect(() => {
		setSelectedIndex((currentIndex) => Math.max(0, Math.min(currentIndex, items.length - 1)))
	}, [items.length])

	const handleSelect = useCallback(
		async (item: HistoryItem) => {
			if (isOpeningTask) return
			setIsOpeningTask(true)
			setLoadError(null)
			try {
				await showTaskWithId(controller, StringRequest.create({ value: item.id }))
				onSelectTask(item.id)
			} catch (error) {
				Logger.error("Failed to open task from history:", error)
				setLoadError(error instanceof Error ? error.message : String(error))
				setIsOpeningTask(false)
			}
		},
		[controller, onSelectTask, isOpeningTask],
	)

	// Visible window
	const scrollOffset = useMemo(() => {
		const half = Math.floor(maxVisible / 2)
		let start = Math.max(0, selectedIndex - half)
		const end = Math.min(items.length, start + maxVisible)
		if (end - start < maxVisible) {
			start = Math.max(0, end - maxVisible)
		}
		return start
	}, [selectedIndex, maxVisible, items.length])

	const visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible)
	const showUpIndicator = scrollOffset > 0
	const showDownIndicator = scrollOffset + maxVisible < items.length

	useInput(
		(input, key) => {
			if (shouldIgnoreTerminalInput(input, key)) {
				return
			}

			if (key.escape) {
				if (searchQuery) {
					setSearchQuery("")
				} else {
					onClose()
				}
				return
			}

			if (key.return && items[selectedIndex]) {
				if (isOpeningTask) return
				handleSelect(items[selectedIndex])
				return
			}

			if (key.upArrow) {
				if (items.length === 0) return
				setSelectedIndex((i) => Math.max(0, i - 1))
				return
			}
			if (key.downArrow) {
				if (items.length === 0) return
				setSelectedIndex((i) => Math.min(items.length - 1, i + 1))
				return
			}

			// Backspace for search
			if (key.backspace || key.delete) {
				setSearchQuery((q) => q.slice(0, -1))
				return
			}

			// Printable characters for search
			if (input && !key.ctrl && !key.meta && input.length === 1 && input.charCodeAt(0) >= 32) {
				setSearchQuery((q) => q + input)
			}
		},
		{ isActive: isRawModeSupported },
	)

	const renderContent = () => {
		if (loading) {
			return <Text color={theme.muted}>Loading history...</Text>
		}

		if (loadError) {
			return <Text color={theme.error}>Could not load history: {loadError}</Text>
		}

		if (items.length === 0) {
			return <Text color={theme.muted}>{searchQuery ? "No tasks match your search." : "No task history."}</Text>
		}

		return (
			<Box flexDirection="column">
				<Text color={theme.muted}>{showUpIndicator ? "  ▲" : " "}</Text>
				{visibleItems.map((item, idx) => {
					const actualIndex = scrollOffset + idx
					const isSelected = actualIndex === selectedIndex
					const isGoal = isGoalHistoryItem(item)
					const taskText = (isGoal ? item.objectivePreview : item.task).replace(/\n/g, " ")
					const cost = isGoal ? item.accounting.cost : item.totalCost
					const meta = [
						formatRelativeDate(item.ts, now),
						...(isGoal ? [`Goal · ${item.status}`] : []),
						formatCost(cost),
					].join(" · ")

					return (
						<Box flexDirection="column" key={item.id}>
							<Box overflow="hidden">
								<Text color={isSelected ? COLORS.primaryBlue : undefined} wrap="truncate">
									{isSelected ? "❯ " : "  "}
									{taskText}
								</Text>
							</Box>
							<Box>
								<Text color={theme.muted}>
									{"  "}
									{meta}
								</Text>
							</Box>
						</Box>
					)
				})}
				<Text color={theme.muted}>{showDownIndicator ? "  ▼" : " "}</Text>
			</Box>
		)
	}

	return (
		<Panel label="History">
			<Box>
				<Text color={theme.muted}>Search: </Text>
				<Text color={theme.text}>{searchQuery}</Text>
				<Text backgroundColor={theme.cursorBg} color={theme.cursorText}> </Text>
			</Box>
			<Box>
				<Text color={theme.muted}>
					{isOpeningTask ? "Opening run..." : searchQuery ? "Esc to clear" : "Enter to open · Esc to close"}
				</Text>
			</Box>
			{renderContent()}
		</Panel>
	)
}

import { theme } from "../constants/theme"
/**
 * History view component
 * Displays task history with keyboard navigation
 */

import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import { Controller } from "@/core/controller"
import { showTaskWithId } from "@/core/controller/task/showTaskWithId"
import { Logger } from "@/shared/services/Logger"
import { StringRequest } from "@/shared/proto/dirac/common"
import { useStdinContext } from "../context/StdinContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import type { GoalHistoryItem, HistoryItem } from "@shared/HistoryItem"

interface LegacyHistoryDisplayItem {
	id: string
	ts: number
	task?: string
	totalCost?: number
	modelId?: string
}

export type HistoryDisplayItem = HistoryItem | LegacyHistoryDisplayItem

function isGoalDisplayItem(item: HistoryDisplayItem): item is GoalHistoryItem {
	return "runKind" in item && item.runKind === "goal"
}

interface HistoryPagination {
	page: number
	totalPages: number
	totalCount: number
	limit: number
}

interface HistoryViewProps {
	items: HistoryDisplayItem[]
	visibleCount?: number
	controller: Controller
	onSelectTask?: (taskId: string) => void
	pagination?: HistoryPagination
	onPageChange?: (page: number) => void
	/** If provided, all items for internal pagination management */
	allItems?: HistoryDisplayItem[]
}

/**
 * Format separator
 */
function formatSeparator(width: number, char = "─"): string {
	return char.repeat(Math.max(1, width))
}

export const HistoryView: React.FC<HistoryViewProps> = ({
	items,
	visibleCount,
	controller,
	onSelectTask,
	pagination,
	onPageChange,
	allItems,
}) => {
	const { exit } = useApp()
	const { isRawModeSupported } = useStdinContext()
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [internalPage, setInternalPage] = useState(pagination?.page ?? 1)
	const [interactionError, setInteractionError] = useState<string | null>(null)
	const [isOpeningTask, setIsOpeningTask] = useState(false)
	const { columns: terminalColumns, rows: terminalRows } = useTerminalSize()

	// Calculate visible count based on terminal height to prevent overflow
	// Each item takes ~5 lines (date, id, task text, cost/model, margin)
	// Reserve lines for header (title, hint, pagination, separator) and footer (separator)
	const headerLines = (pagination?.totalPages ?? 1) > 1 ? 5 : 4
	const footerLines = 1
	const availableRows = terminalRows - headerLines - footerLines
	const itemHeight = 5
	const dynamicVisibleCount = Math.max(1, Math.floor(availableRows / itemHeight))
	const effectiveVisibleCount = Math.min(dynamicVisibleCount, Math.max(1, visibleCount ?? dynamicVisibleCount))

	const onSelect = useCallback(
		async (item: HistoryDisplayItem) => {
			if (isOpeningTask) return
			setIsOpeningTask(true)
			setInteractionError(null)
			// Load the task via controller, then notify parent to switch views
			try {
				await showTaskWithId(controller, StringRequest.create({ value: item.id }))
				onSelectTask?.(item.id)
			} catch (error) {
				Logger.error("Failed to open task from history:", error)
				setInteractionError(error instanceof Error ? error.message : String(error))
			} finally {
				setIsOpeningTask(false)
			}
		},
		[controller, isOpeningTask, onSelectTask],
	)

	// Use internal pagination if allItems is provided, otherwise use external
	const useInternalPagination = !!allItems
	const limit = pagination?.limit ?? 10
	const totalCount = allItems?.length ?? pagination?.totalCount ?? items.length
	const totalPages = Math.max(1, useInternalPagination ? Math.ceil(totalCount / limit) : (pagination?.totalPages ?? 1))
	const currentPage = useInternalPagination ? internalPage : (pagination?.page ?? 1)
	const hasPrevPage = currentPage > 1
	const hasNextPage = currentPage < totalPages

	// Get current page items
	const pageItems = useInternalPagination ? (allItems ?? []).slice((currentPage - 1) * limit, currentPage * limit) : items

	useEffect(() => {
		if (useInternalPagination && internalPage > totalPages) {
			setInternalPage(totalPages)
		}
	}, [internalPage, totalPages, useInternalPagination])

	useEffect(() => {
		setSelectedIndex((currentIndex) => Math.max(0, Math.min(currentIndex, pageItems.length - 1)))
	}, [currentPage, pageItems.length])

	const handlePageChange = useCallback(
		(newPage: number) => {
			if (useInternalPagination) {
				setInternalPage(newPage)
				setSelectedIndex(0)
			} else if (onPageChange) {
				onPageChange(newPage)
				setSelectedIndex(0)
			}
		},
		[useInternalPagination, onPageChange],
	)

	useInput(
		(input, key) => {
			if (key.escape) {
				exit()
				return
			}
			if (key.upArrow || input === "k") {
				if (pageItems.length === 0) return
				setSelectedIndex((prev) => Math.max(0, prev - 1))
			} else if (key.downArrow || input === "j") {
				if (pageItems.length === 0) return
				setSelectedIndex((prev) => Math.min(pageItems.length - 1, prev + 1))
			} else if (key.return && pageItems[selectedIndex]) {
				if (isOpeningTask) return
				onSelect(pageItems[selectedIndex])
			} else if (key.leftArrow && hasPrevPage) {
				handlePageChange(currentPage - 1)
			} else if (key.rightArrow && hasNextPage) {
				handlePageChange(currentPage + 1)
			} else if (input === "n" && hasNextPage) {
				handlePageChange(currentPage + 1)
			} else if (input === "p" && hasPrevPage) {
				handlePageChange(currentPage - 1)
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Calculate visible window around selected item
	const halfVisible = Math.floor(effectiveVisibleCount / 2)
	let startIndex = Math.max(0, selectedIndex - halfVisible)
	const endIndex = Math.min(pageItems.length, startIndex + effectiveVisibleCount)
	// Adjust start if we're near the end
	if (endIndex - startIndex < effectiveVisibleCount) {
		startIndex = Math.max(0, endIndex - effectiveVisibleCount)
	}
	const visibleTasks = pageItems.slice(startIndex, endIndex)

	const showUpIndicator = startIndex > 0
	const showDownIndicator = endIndex < pageItems.length

	return (
		<Box flexDirection="column">
			<Text bold color={theme.text}>
				{"📜 Run History (" + totalCount + " total)"}
			</Text>
			<Text color={theme.muted}>Use ↑↓/j/k to navigate, Enter to select</Text>

			{totalPages > 1 && (
				<Box>
					<Text color={theme.muted}>
						Page {currentPage} of {totalPages}{" "}
					</Text>
					{hasPrevPage ? <Text color={theme.link}>[← prev] </Text> : <Text color={theme.muted}>[← prev] </Text>}
					{hasNextPage ? <Text color={theme.link}>[next →]</Text> : <Text color={theme.muted}>[next →]</Text>}
				</Box>
			)}
			<Text>{formatSeparator(terminalColumns)}</Text>

			{interactionError && <Text color={theme.error}>Failed to open run: {interactionError}</Text>}

			{pageItems.length === 0 ? (
				<Text>No task history available.</Text>
			) : (
				<Box flexDirection="column">
					{showUpIndicator && <Text color={theme.muted}>{"  ↑ " + startIndex + " more above"}</Text>}
					{visibleTasks.map((task, index) => {
						const actualIndex = startIndex + index
						const isSelected = actualIndex === selectedIndex
						const date = new Date(task.ts).toLocaleString()
						const isGoal = isGoalDisplayItem(task)
						const displayText = isGoal ? task.objectivePreview : (task.task ?? "")
						const taskText = displayText.substring(0, 60) || "Unknown run"
						const truncated = displayText.length > 60 ? "..." : ""
						const cost = isGoal ? task.accounting.cost : task.totalCost

						return (
							<Box flexDirection="column" key={`${task.id}-${actualIndex}`} marginBottom={1}>
								<Box>
									<Text color={isSelected ? theme.success : undefined}>{isSelected ? "> " : "  "}</Text>
									<Text color={theme.muted}>{date}</Text>
								</Box>
								<Box marginLeft={4}>
									<Text color={theme.info}>{isGoal ? `[Goal · ${task.status}] ` : ""}{task.id}</Text>
								</Box>
								<Box marginLeft={4}>
									<Text bold={isSelected} color={isSelected ? theme.strongText : undefined}>
										{taskText}
										{truncated}
									</Text>
								</Box>
								{isGoal ? (
									<Box marginLeft={4}>
										<Text color={theme.muted}>Cost: {cost === undefined ? "—" : `$${cost.toFixed(4)}`}</Text>
									</Box>
								) : typeof cost === "number" ? (
									<Box marginLeft={4}>
										<Text color={theme.muted}>Cost: ${cost.toFixed(4)}</Text>
									</Box>
								) : null}
								{task.modelId && (
									<Box marginLeft={4}>
										<Text color={theme.muted}>Model: {task.modelId}</Text>
									</Box>
								)}
							</Box>
						)
					})}
					{showDownIndicator && <Text color={theme.muted}>{"  ↓ " + (pageItems.length - endIndex) + " more below"}</Text>}
				</Box>
			)}

			<Text>{formatSeparator(terminalColumns)}</Text>
		</Box>
	)
}

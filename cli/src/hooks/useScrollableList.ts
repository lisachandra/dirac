/**
 * Shared hook for scrollable list windowing in terminal UIs
 * Used by AuthView (provider list) and ModelPicker (model list)
 */

import { useMemo } from "react"

interface ScrollableListResult {
	visibleStart: number
	visibleCount: number
	showTopIndicator: boolean
	showBottomIndicator: boolean
}

export function calculateScrollableList(
	itemCount: number,
	selectedIndex: number,
	maxRows: number,
): ScrollableListResult {
	if (itemCount === 0) {
		return {
			visibleStart: 0,
			visibleCount: 0,
			showTopIndicator: false,
			showBottomIndicator: false,
		}
	}

	const rowBudget = Math.max(1, Math.floor(maxRows))
	const boundedSelectedIndex = Math.max(0, Math.min(selectedIndex, itemCount - 1))
	if (itemCount <= rowBudget) {
		return {
			visibleStart: 0,
			visibleCount: itemCount,
			showTopIndicator: false,
			showBottomIndicator: false,
		}
	}

	let visibleCount = rowBudget
	let visibleStart = Math.max(
		0,
		Math.min(boundedSelectedIndex - Math.floor(visibleCount / 2), itemCount - visibleCount),
	)

	for (let pass = 0; pass < 3; pass++) {
		const hasItemsAbove = visibleStart > 0
		const hasItemsBelow = visibleStart + visibleCount < itemCount
		const nextVisibleCount = Math.max(1, rowBudget - Number(hasItemsAbove) - Number(hasItemsBelow))
		if (nextVisibleCount === visibleCount) break
		visibleCount = nextVisibleCount
		visibleStart = Math.max(
			0,
			Math.min(boundedSelectedIndex - Math.floor(visibleCount / 2), itemCount - visibleCount),
		)
	}

	let showTopIndicator = visibleStart > 0
	let showBottomIndicator = visibleStart + visibleCount < itemCount
	let availableIndicatorRows = rowBudget - visibleCount
	if (showTopIndicator && availableIndicatorRows > 0) availableIndicatorRows--
	else showTopIndicator = false
	if (showBottomIndicator && availableIndicatorRows > 0) availableIndicatorRows--
	else showBottomIndicator = false

	return {
		visibleStart,
		visibleCount,
		showTopIndicator,
		showBottomIndicator,
	}
}

/**
 * Calculate visible window for a scrollable list.
 * Keeps the selected item in view while fitting indicators into the row budget.
 */
export function useScrollableList(itemCount: number, selectedIndex: number, maxRows: number): ScrollableListResult {
	return useMemo(() => calculateScrollableList(itemCount, selectedIndex, maxRows), [itemCount, selectedIndex, maxRows])
}
import type { HistoryItem } from "@shared/HistoryItem"
import { cleanup, render, screen } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DateGroupedHistoryList } from "./HistoryView"

vi.stubGlobal(
	"ResizeObserver",
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
)

afterEach(cleanup)

function task(id: string, ts: number): HistoryItem {
	return {
		id,
		ts,
		task: id,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
}

describe("DateGroupedHistoryList", () => {
	it("renders every task newest-first without losing tasks at date-group boundaries", () => {
		const groupedTasks = [
			task("newest", 50),
			task("second", 40),
			task("third", 30),
			task("older-newest", 20),
			task("oldest", 10),
		]

		render(
			<VirtuosoMockContext.Provider value={{ viewportHeight: 1_000, itemHeight: 50 }}>
				<DateGroupedHistoryList
					groupCounts={[3, 2]}
					groupedTasks={groupedTasks}
					groupLabels={["Today", "Older"]}
					renderHistoryItem={(item) => <div data-testid="history-item">{item.id}</div>}
				/>
			</VirtuosoMockContext.Provider>,
		)

		expect(screen.getAllByTestId("history-item").map((item) => item.textContent)).toEqual([
			"newest",
			"second",
			"third",
			"older-newest",
			"oldest",
		])
		expect(screen.getByText("Today")).toBeInTheDocument()
		expect(screen.getByText("Older")).toBeInTheDocument()
	})
})

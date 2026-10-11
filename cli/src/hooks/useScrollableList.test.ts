import { describe, expect, it } from "vitest"
import { calculateScrollableList } from "./useScrollableList"

describe("calculateScrollableList", () => {
	it.each([0, 4, 8])("keeps selected item %s visible with a one-row budget", (selectedIndex) => {
		const window = calculateScrollableList(9, selectedIndex, 1)

		expect(window).toEqual({
			visibleStart: selectedIndex,
			visibleCount: 1,
			showTopIndicator: false,
			showBottomIndicator: false,
		})
	})

	it("fits indicators and the selected item within the row budget", () => {
		const window = calculateScrollableList(9, 4, 3)

		expect(window.visibleStart).toBe(4)
		expect(window.visibleCount).toBe(1)
		expect(window.showTopIndicator).toBe(true)
		expect(window.showBottomIndicator).toBe(true)
	})
})

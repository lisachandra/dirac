import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { isLongUserMessage, UserMessageContent } from "./UserMessageContent"

const createMultilineMessage = (lineCount: number) =>
	Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join("\n")

describe("UserMessageContent", () => {
	it("preserves newlines in ordinary user messages", () => {
		const { container } = render(
			<UserMessageContent content={"first line\nsecond line\nthird line"} isExpanded={false} onToggleExpand={vi.fn()} />,
		)

		expect(container.firstElementChild).toHaveClass("whitespace-pre-wrap")
		expect(container.firstElementChild?.textContent).toContain("first line\nsecond line\nthird line")
		expect(screen.queryByRole("button", { name: /long message/i })).not.toBeInTheDocument()
	})

	it("collapses a long multiline message to a five-line preview", () => {
		const onToggleExpand = vi.fn()
		render(
			<UserMessageContent content={createMultilineMessage(12)} isExpanded={false} onToggleExpand={onToggleExpand} />,
		)

		const toggle = screen.getByRole("button", { name: "Expand long message (12 lines)" })
		expect(toggle).toHaveAttribute("aria-expanded", "false")
		expect(screen.getByText("Long message")).toBeInTheDocument()
		expect(screen.queryByText("line 12")).not.toBeInTheDocument()

		fireEvent.click(toggle)
		expect(onToggleExpand).toHaveBeenCalledTimes(1)
	})

	it("shows the full formatted content in a bounded region when expanded", () => {
		const { container } = render(
			<UserMessageContent content={createMultilineMessage(12)} isExpanded={true} onToggleExpand={vi.fn()} />,
		)

		expect(screen.getByRole("button", { name: "Collapse long message (12 lines)" })).toHaveAttribute(
			"aria-expanded",
			"true",
		)
		expect(container.querySelector(".max-h-\\[50vh\\]")).toHaveClass("overflow-y-auto", "whitespace-pre-wrap")
		expect(container.textContent).toContain("line 12")
	})

	it("also treats large messages with fewer long lines as collapsible", () => {
		expect(isLongUserMessage(["a".repeat(400), "b".repeat(400), "c".repeat(400), "tail"].join("\n"))).toBe(true)
	})
})

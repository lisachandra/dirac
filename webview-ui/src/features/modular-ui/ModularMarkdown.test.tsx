import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ModularMarkdown } from "./ModularMarkdown"

const longMessage = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n")

describe("ModularMarkdown message roles", () => {
	it("uses the long-message disclosure for user content", () => {
		render(
			<ModularMarkdown
				content={longMessage}
				isExpanded={false}
				onToggleExpand={vi.fn()}
				role="user"
			/>,
		)

		expect(screen.getByRole("button", { name: "Expand long message (12 lines)" })).toBeInTheDocument()
	})

	it("leaves assistant content on the normal Markdown renderer", () => {
		const { container } = render(<ModularMarkdown content={longMessage} role="assistant" />)

		expect(container.querySelector(".modular-message-assistant")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /long message/i })).not.toBeInTheDocument()
	})
})

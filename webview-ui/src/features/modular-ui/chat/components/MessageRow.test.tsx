import { type DiracMessage, DiracMessageType } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useChatStore } from "@/features/chat/store/chatStore"
import { MessageRenderer } from "./MessageRow"

const streamingReasoning: DiracMessage = {
	id: "reasoning-stream",
	ts: 1,
	content: {
		type: DiracMessageType.MARKDOWN,
		content: "",
		isReasoning: true,
		role: "assistant",
	},
}

const rendererProps = {
	isExpanded: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

describe("MessageRenderer reasoning streams", () => {
	it("keeps incremental reasoning inside the thinking wrapper until completion", () => {
		useChatStore.setState({
			presentationAppends: new Map([
				[streamingReasoning.id, { revision: 1, chunks: ["Inspecting files..."] }],
			]),
		})

		const { container, rerender } = render(
			<MessageRenderer {...rendererProps} activeVoiceStreamId={streamingReasoning.id} message={streamingReasoning} />,
		)

		const streamingTitle = screen.getByText("Thinking...")
		expect(streamingTitle).toHaveClass("animate-shimmer")
		expect(streamingTitle.closest('[role="button"]')?.querySelector("svg")).toHaveClass(
			"text-warning/80",
			"animate-bulb-glow",
		)
		expect(container.querySelector("pre")).toHaveTextContent("Inspecting files...")
		expect(container.querySelector(".modular-message-assistant")).not.toBeInTheDocument()

		act(() => {
			useChatStore.setState({
				presentationAppends: new Map([
					[streamingReasoning.id, { revision: 2, chunks: ["Inspecting files...", "\nChoosing fix..."] }],
				]),
			})
		})
		expect(container.querySelector("pre")).toHaveTextContent("Inspecting files... Choosing fix...")

		const completedReasoning: DiracMessage = {
			...streamingReasoning,
			content: {
				...streamingReasoning.content,
				content: "Inspecting files...\n\nChoosing fix...",
			},
		}
		act(() => useChatStore.setState({ presentationAppends: new Map() }))
		rerender(<MessageRenderer {...rendererProps} message={completedReasoning} />)

		const completedTitle = screen.getByText("Thinking")
		expect(completedTitle).not.toHaveClass("animate-shimmer")
		expect(completedTitle.closest('[role="button"]')?.querySelector("svg")).toHaveClass("text-description/25")
		expect(screen.getByText("Choosing fix...")).toBeInTheDocument()
	})
})

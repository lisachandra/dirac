import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest transforms this test with the classic JSX runtime.
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatFooter } from "./ChatFooter"

vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({ columns: 120, rows: 40, resizeKey: 0 }),
}))

function renderFooter(quietMode: boolean, fastModeEnabled = false, isGoalActive = false) {
	return render(
		<ChatFooter
			autoApproveAll={false}
			cacheHitRate={0}
			contextWindowSize={100_000}
			gitBranch={null}
			gitDiffStats={null}
			lastApiReqTotalTokens={0}
			mode="act"
			modelId="test-model"
			fastModeEnabled={fastModeEnabled}
			isGoalActive={isGoalActive}
			provider="test-provider"
			quietMode={quietMode}
			totalCost={0}
			workspacePath="/workspace/project"
			yoloMode={false}
		/>,
	)
}

describe("ChatFooter modes", () => {
	it("separates auto-approve, YOLO, and quiet mode with middle dots", () => {
		const frame = renderFooter(false).lastFrame() || ""
		expect(frame).toContain("Auto-approve all disabled (Shift+Tab) · YOLO mode disabled · Quiet mode disabled (/quiet)")
	})

	it("shows when quiet mode is enabled", () => {
		const frame = renderFooter(true).lastFrame() || ""
		expect(frame).toContain("Quiet mode enabled (/quiet)")
	})

	it("shows fast mode next to the model when enabled", () => {
		const frame = renderFooter(false, true).lastFrame() || ""
		expect(frame).toContain("test-provider: test-model fast")
	})

	it("uses a compact Goal marker without mode-lock or accounting duplication", () => {
		const frame = renderFooter(false, false, true).lastFrame() || ""
		expect(frame).toContain("Act (Goal)")
		expect(frame).toContain("Ctrl+G details")
		expect(frame).toContain("test-provider: test-model · project · Auto off · YOLO off · Quiet off")
		expect(frame).not.toContain("locked")
		expect(frame).not.toContain("usage")
		expect(frame.split("\n")).toHaveLength(2)
	})
})

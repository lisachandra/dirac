import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { TabList, TabTrigger } from "./Tab"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

const TooltipWrappedTabs = () => {
	const [value, setValue] = useState("models-api")

	return (
		<TabList aria-label="Settings destinations" aria-orientation="vertical" onValueChange={setValue} value={value}>
			<Tooltip>
				<TooltipTrigger asChild>
					<TabTrigger aria-label="Models & API" value="models-api">
						Models & API
					</TabTrigger>
				</TooltipTrigger>
				<TooltipContent side="right">Choose the provider and model used for your main task.</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<TabTrigger aria-label="General" value="general">
						General
					</TabTrigger>
				</TooltipTrigger>
				<TooltipContent side="right">Privacy, diagnostics, help, support, and version information.</TooltipContent>
			</Tooltip>
		</TabList>
	)
}

describe("TabList", () => {
	afterEach(cleanup)

	it("renders and selects tabs wrapped in tooltip primitives", async () => {
		const user = userEvent.setup()
		render(<TooltipWrappedTabs />)

		const modelsTab = screen.getByRole("tab", { name: "Models & API" })
		const generalTab = screen.getByRole("tab", { name: "General" })
		expect(modelsTab).toHaveAttribute("aria-selected", "true")
		expect(modelsTab).toHaveAttribute("tabindex", "0")
		expect(generalTab).toHaveAttribute("aria-selected", "false")
		expect(generalTab).toHaveAttribute("tabindex", "-1")

		await user.click(generalTab)
		expect(generalTab).toHaveAttribute("aria-selected", "true")
		expect(generalTab).toHaveAttribute("tabindex", "0")

		await user.keyboard("{ArrowUp}")
		expect(modelsTab).toHaveFocus()
		expect(modelsTab).toHaveAttribute("aria-selected", "true")
	})
})

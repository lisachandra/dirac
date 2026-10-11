import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppStore } from "@/app/store/appStore"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient } from "@/shared/api/grpc-client"
import AutoApproveModal from "./AutoApproveModal"

vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const React = await import("react")
	return {
		VSCodeCheckbox: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
			({ children, ...props }, ref) => (
				<label>
					<input ref={ref} type="checkbox" {...props} />
					{children}
				</label>
			),
		),
	}
})

function renderModal(setIsVisible = vi.fn()) {
	render(<AutoApproveModal buttonRef={createRef<HTMLButtonElement>()} isVisible={true} setIsVisible={setIsVisible} />)
	return setIsVisible
}

function resetSettings() {
	useSettingsStore.setState({
		autoApprovalSettings: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions },
		},
		autoApproveAllToggled: false,
		autoApproveAllUpdateError: undefined,
		pendingAutoApproveAllToggled: undefined,
		remoteConfigSettings: {},
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
	})
	useAppStore.setState({
		settingsTargetSection: undefined,
		showSettings: false,
	})
}

describe("AutoApproveModal", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetSettings()
	})

	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it("renders every approval switch in the composer menu", () => {
		renderModal()

		for (const label of [
			"Read project files",
			"Read all files",
			"Edit project files",
			"Edit all files",
			"Auto-approve safe commands",
			"Use the browser",
			"Apply edits with anchors",
			"Enable notifications",
			"Strict Plan Mode",
			"Approve All",
			"YOLO Mode",
		]) {
			expect(screen.getByRole("checkbox", { name: label })).toBeInTheDocument()
		}
	})

	it("updates individual actions, notifications, and policy switches in place", async () => {
		const updateAutoApprovalSettings = vi
			.spyOn(StateServiceClient, "updateAutoApprovalSettings")
			.mockResolvedValue({})
		const updateSettings = vi.spyOn(StateServiceClient, "updateSettings").mockResolvedValue({})
		const user = userEvent.setup()
		renderModal()

		await user.click(screen.getByRole("checkbox", { name: "Use the browser" }))
		await waitFor(() =>
			expect(updateAutoApprovalSettings).toHaveBeenCalledWith(
				expect.objectContaining({ actions: expect.objectContaining({ useBrowser: true }) }),
			),
		)

		await user.click(screen.getByRole("checkbox", { name: "Enable notifications" }))
		await waitFor(() =>
			expect(updateAutoApprovalSettings).toHaveBeenCalledWith(expect.objectContaining({ enableNotifications: true })),
		)

		await user.click(screen.getByRole("checkbox", { name: "Strict Plan Mode" }))
		await user.click(screen.getByRole("checkbox", { name: "YOLO Mode" }))
		await waitFor(() => {
			expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ strictPlanModeEnabled: true }))
			expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ yoloModeToggled: true }))
		})
	})

	it("applies YOLO precedence and organization locking to approval switches", () => {
		useSettingsStore.setState({ remoteConfigSettings: { yoloModeToggled: true } })
		renderModal()

		expect(screen.getByRole("checkbox", { name: "YOLO Mode" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "YOLO Mode" })).toBeDisabled()
		expect(screen.getByRole("checkbox", { name: "Approve All" })).toBeDisabled()
		expect(screen.getByRole("checkbox", { name: "Read project files" })).toBeDisabled()
		expect(screen.getByRole("checkbox", { name: "Read all files" })).toBeDisabled()
		expect(screen.getByRole("checkbox", { name: "Enable notifications" })).not.toBeDisabled()
	})

	it("rolls back Approve All and surfaces update failures", async () => {
		vi.spyOn(StateServiceClient, "updateSettings").mockRejectedValue(new Error("update failed"))
		const user = userEvent.setup()
		renderModal()

		await user.click(screen.getByRole("checkbox", { name: "Approve All" }))

		await waitFor(() => expect(screen.getByText("update failed")).toBeInTheDocument())
		expect(useSettingsStore.getState().autoApproveAllToggled).toBe(false)
		expect(useSettingsStore.getState().pendingAutoApproveAllToggled).toBeUndefined()
	})

	it("keeps advanced approval configuration available from the menu", async () => {
		const setIsVisible = renderModal()
		const user = userEvent.setup()

		await user.click(screen.getByRole("button", { name: "More approval settings…" }))

		expect(setIsVisible).toHaveBeenCalledWith(false)
		expect(useAppStore.getState().showSettings).toBe(true)
		expect(useAppStore.getState().settingsTargetSection).toBe("approvals")
	})
})

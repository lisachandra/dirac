import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import UtilityModelSelection from "./UtilityModelSelection"

const mockUpdateSetting = vi.fn()
const mockPersistSetting = vi.fn()
const mockPermissionSettings = vi.hoisted(() => ({ enabled: false, policy: "" }))

vi.mock("@/features/settings/store/settingsStore", () => ({
	useSettingsStore: vi.fn(() => ({
		utilityModelSelection: undefined,
		utilityModelUseCondense: true,
		utilityModelUseNewTask: true,
		utilityModelUseGenerateCommitMessage: true,
		utilityModelUsePermissionHandling: mockPermissionSettings.enabled,
		utilityModelPermissionPolicy: mockPermissionSettings.policy,
		openRouterModels: {},
		openAiModels: {},
		liteLlmModels: {},
		requestyModels: {},
		groqModels: {},
		basetenModels: {},
		huggingFaceModels: {},
		vercelAiGatewayModels: {},
	})),
}))

vi.mock("./utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
	persistSetting: (...args: unknown[]) => mockPersistSetting(...args),
}))

vi.mock("./common/ModelAutocomplete", () => ({
	ModelAutocomplete: ({ onChange, selectedModelId }: any) => (
		<input
			aria-label="Model"
			value={selectedModelId || ""}
			onChange={(event) => onChange(event.target.value, { supportsPromptCache: false })}
		/>
	),
}))

vi.mock("@shared/proto-conversions/models/api-configuration-conversion", () => ({
	convertModelProviderSelectionToProto: (selection: unknown) => selection,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, ...props }: any) => (
		<label>
			<input type="checkbox" {...props} />
			{children}
		</label>
	),
}))

describe("UtilityModelSelection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockPersistSetting.mockReset()
		mockPersistSetting.mockResolvedValue(undefined)
		mockPermissionSettings.enabled = false
		mockPermissionSettings.policy = ""
	})

	it("shows each Utility use case enabled by default", () => {
		render(<UtilityModelSelection />)

		expect(screen.getByRole("checkbox", { name: "Condense conversation" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "New task handoffs" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "Generate commit messages" })).toBeChecked()
		expect(screen.getByRole("checkbox", { name: "Handle permission requests" })).not.toBeChecked()
	})

	it("persists each use case independently", () => {
		render(<UtilityModelSelection />)

		fireEvent.click(screen.getByRole("checkbox", { name: "New task handoffs" }))
		expect(mockUpdateSetting).toHaveBeenCalledWith("utilityModelUseNewTask", false)
	})

	it("persists permission handling independently", () => {
		render(<UtilityModelSelection />)

		fireEvent.click(screen.getByRole("checkbox", { name: "Handle permission requests" }))
		expect(mockUpdateSetting).toHaveBeenCalledWith("utilityModelUsePermissionHandling", true)
	})

	it("persists the verbatim permission policy on blur", async () => {
		mockPermissionSettings.enabled = true
		mockPermissionSettings.policy = "Ask before network calls."
		render(<UtilityModelSelection />)

		const policy = screen.getByRole("textbox", { name: "Permission policy" })
		fireEvent.change(policy, { target: { value: "Allow edits.\nNever allow network calls." } })
		fireEvent.blur(policy)

		await waitFor(() =>
			expect(mockPersistSetting).toHaveBeenCalledWith(
				"utilityModelPermissionPolicy",
				"Allow edits.\nNever allow network calls.",
			),
		)
	})

	it("surfaces a permission policy persistence failure", async () => {
		mockPermissionSettings.enabled = true
		mockPersistSetting.mockRejectedValueOnce(new Error("save failed"))
		render(<UtilityModelSelection />)

		const policy = screen.getByRole("textbox", { name: "Permission policy" })
		fireEvent.change(policy, { target: { value: "Allow edits." } })
		fireEvent.blur(policy)

		expect(await screen.findByText("Permission policy was not saved. Blur the field to retry.")).toBeVisible()
	})

	it("persists an arbitrary model ID for the selected provider", () => {
		render(<UtilityModelSelection />)

		fireEvent.change(screen.getByLabelText("Utility model provider"), { target: { value: "openai" } })
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "custom-utility-model" } })

		expect(mockUpdateSetting).toHaveBeenLastCalledWith(
			"utilityModelSelection",
			expect.objectContaining({ provider: "openai", modelId: "custom-utility-model" }),
		)
	})
})

import "@testing-library/jest-dom/vitest"
import { OpenAiCodexAuthEvent, OpenAiCodexAuthMethod } from "@shared/proto/dirac/models"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Callbacks } from "@/shared/api/grpc-client-base"
import { OpenAiCodexSignIn } from "./OpenAiCodexSignIn"

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), cancel: vi.fn(), copy: vi.fn(), open: vi.fn() }))
vi.mock("@/shared/api/grpc-client", () => ({
	ModelsServiceClient: { authenticateOpenAiCodex: mocks.authenticate },
	FileServiceClient: { copyToClipboard: mocks.copy },
	UiServiceClient: { openUrl: mocks.open },
}))

function callbacks(index = 0): Callbacks<OpenAiCodexAuthEvent> {
	return mocks.authenticate.mock.calls[index][1]
}

describe("ChatGPT sign-in choices", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.authenticate.mockReturnValue(mocks.cancel)
		mocks.copy.mockResolvedValue({})
		mocks.open.mockResolvedValue({})
	})
	afterEach(cleanup)

	it("does not start login until a method is chosen", () => {
		render(<OpenAiCodexSignIn />)
		expect(screen.getByRole("button", { name: "Browser link" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Device code" })).toBeInTheDocument()
		expect(mocks.authenticate).not.toHaveBeenCalled()
		expect(mocks.open).not.toHaveBeenCalled()
	})

	it("offers copy and explicit browser opening for the browser link", async () => {
		render(<OpenAiCodexSignIn />)
		fireEvent.click(screen.getByRole("button", { name: "Browser link" }))
		expect(mocks.authenticate.mock.calls[0][0].method).toBe(OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_BROWSER)
		act(() =>
			callbacks().onResponse(OpenAiCodexAuthEvent.create({ url: "https://auth.openai.com/oauth/authorize?state=test" })),
		)
		expect(mocks.open).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Link copied"))
		expect(mocks.copy).toHaveBeenCalledWith(
			expect.objectContaining({ value: "https://auth.openai.com/oauth/authorize?state=test" }),
		)
		fireEvent.click(screen.getByRole("button", { name: "Open browser" }))
		expect(mocks.open).toHaveBeenCalledTimes(1)
	})

	it("shows and copies the device code without opening a browser", async () => {
		render(<OpenAiCodexSignIn />)
		fireEvent.click(screen.getByRole("button", { name: "Device code" }))
		expect(mocks.authenticate.mock.calls[0][0].method).toBe(OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE)
		act(() =>
			callbacks().onResponse(
				OpenAiCodexAuthEvent.create({ url: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" }),
			),
		)
		expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }))
		await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({ value: "ABCD-EFGH" })))
		expect(mocks.open).not.toHaveBeenCalled()
	})

	it("cancels on navigation and ignores late events from a cancelled attempt", () => {
		const view = render(<OpenAiCodexSignIn />)
		fireEvent.click(screen.getByRole("button", { name: "Browser link" }))
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(mocks.cancel).toHaveBeenCalledTimes(1)
		fireEvent.click(screen.getByRole("button", { name: "Device code" }))
		act(() => callbacks(0).onError(new Error("Old attempt")))
		expect(screen.queryByText(/Old attempt/)).not.toBeInTheDocument()
		view.unmount()
		expect(mocks.cancel).toHaveBeenCalledTimes(2)
	})

	it("allows retry after an error and clears waiting state on completion", () => {
		render(<OpenAiCodexSignIn />)
		fireEvent.click(screen.getByRole("button", { name: "Device code" }))
		act(() => {
			callbacks().onError(new Error("Device code expired"))
			callbacks().onComplete()
		})
		expect(screen.getByRole("alert")).toHaveTextContent("Device code expired")
		fireEvent.click(screen.getByRole("button", { name: "Browser link" }))
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		act(() => callbacks(1).onComplete())
		expect(screen.getByRole("button", { name: "Browser link" })).toBeInTheDocument()
	})
})

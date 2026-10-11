import type { OpenAiCodexAuthInstructions } from "@shared/openai-codex-auth"
import type { Key } from "ink"
import { render } from "ink-testing-library"
// biome-ignore lint/correctness/noUnusedImports: Vitest uses the classic JSX runtime.
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAiCodexAuthView } from "./OpenAiCodexAuthView"

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn(),
	copy: vi.fn(),
	open: vi.fn(),
	clearUsage: vi.fn(),
	input: undefined as ((input: string, key: Key) => void) | undefined,
}))
vi.mock("ink", async (original) => ({
	...(await original<typeof import("ink")>()),
	useInput: (input: (input: string, key: Key) => void) => {
		mocks.input = input
	},
}))
vi.mock("../context/StdinContext", () => ({ useStdinContext: () => ({ isRawModeSupported: true }) }))
vi.mock("@/integrations/openai-codex/oauth", () => ({ openAiCodexOAuthManager: { authenticate: mocks.authenticate } }))
vi.mock("@/integrations/openai-codex/OpenAiCodexUsageService", () => ({ openAiCodexUsageService: { clear: mocks.clearUsage } }))
vi.mock("@/utils/env", () => ({ openExternal: mocks.open }))
vi.mock("../utils/clipboard", () => ({ copyToClipboardNative: mocks.copy }))

const pause = () => new Promise((resolve) => setTimeout(resolve, 60))
function press(input: string, key: Partial<Key> = {}) {
	mocks.input!(input, key as Key)
}
const views: Array<ReturnType<typeof render>> = []
function mount(onComplete = vi.fn(), onCancel = vi.fn()) {
	const view = render(<OpenAiCodexAuthView onComplete={onComplete} onCancel={onCancel} />)
	views.push(view)
	return view
}

describe("interactive ChatGPT login", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.copy.mockReturnValue(true)
		mocks.open.mockResolvedValue(undefined)
		mocks.authenticate.mockImplementation(async (method: string, ready: (data: OpenAiCodexAuthInstructions) => void) => {
			ready({ url: "https://auth.openai.com/test", ...(method === "device" ? { userCode: "ABCD-EFGH" } : {}) })
			await new Promise(() => {})
		})
	})
	afterEach(() => {
		for (const view of views.splice(0)) view.unmount()
	})

	it.each(["browser", "device"])("offers copy/open shortcuts for %s without automatic browser launch", async (method) => {
		const view = mount()
		expect(view.lastFrame()).toContain("Browser link")
		expect(view.lastFrame()).toContain("Device code")
		expect(mocks.authenticate).not.toHaveBeenCalled()
		await pause()
		press(method === "browser" ? "b" : "d")
		await pause()
		expect(mocks.authenticate.mock.calls[0][0]).toBe(method)
		expect(mocks.open).not.toHaveBeenCalled()
		press("c")
		expect(mocks.copy).toHaveBeenCalledWith(method === "device" ? "ABCD-EFGH" : "https://auth.openai.com/test")
		press("o")
		expect(mocks.open).toHaveBeenCalledWith("https://auth.openai.com/test")
	})

	it("aborts on Escape and ignores late completion", async () => {
		let complete!: () => void
		mocks.authenticate.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve
				}),
		)
		const onComplete = vi.fn()
		const onCancel = vi.fn()
		mount(onComplete, onCancel)
		await pause()
		press("d")
		await pause()
		const signal = mocks.authenticate.mock.calls[0][2] as AbortSignal
		press("", { escape: true })
		expect(signal.aborted).toBe(true)
		expect(onCancel).toHaveBeenCalledOnce()
		complete()
		await pause()
		expect(onComplete).not.toHaveBeenCalled()
	})

	it("can retry a failed attempt and reports successful authentication", async () => {
		mocks.authenticate.mockRejectedValueOnce(new Error("Device code expired")).mockResolvedValueOnce(undefined)
		const complete = vi.fn()
		const view = mount(complete)
		await pause()
		press("d")
		await pause()
		expect(view.lastFrame()).toContain("Device code expired")
		press("r")
		await pause()
		expect(complete).toHaveBeenCalledOnce()
		expect(mocks.clearUsage).toHaveBeenCalledOnce()
	})
})

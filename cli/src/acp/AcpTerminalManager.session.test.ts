import { describe, expect, it, vi } from "vitest"
import { AcpTerminalManager } from "./AcpTerminalManager.js"

function terminalHandle(id: string) {
	return {
		id,
		currentOutput: vi.fn(),
		waitForExit: vi.fn(),
		kill: vi.fn(),
		release: vi.fn(),
	} as any
}

describe("AcpTerminalManager active-session routing", () => {
	it("resolves the current session for each terminal request", async () => {
		const connection = {
			createTerminal: vi
				.fn()
				.mockResolvedValueOnce(terminalHandle("terminal-a"))
				.mockResolvedValueOnce(terminalHandle("terminal-b")),
		} as any
		let sessionId: string | undefined = "session-a"
		const resolver = vi.fn(() => sessionId)
		const manager = new AcpTerminalManager(connection, { terminal: true }, resolver)

		await manager.createTerminal({ command: "echo a", cwd: "/workspace" })
		sessionId = "session-b"
		await manager.createTerminal({ command: "echo b", cwd: "/workspace" })

		expect(resolver).toHaveBeenCalledTimes(2)
		expect(connection.createTerminal).toHaveBeenNthCalledWith(1, {
			sessionId: "session-a",
			command: "echo a",
			cwd: "/workspace",
		})
		expect(connection.createTerminal).toHaveBeenNthCalledWith(2, {
			sessionId: "session-b",
			command: "echo b",
			cwd: "/workspace",
		})
	})

	it("rejects outside an active session before invoking the client", async () => {
		const connection = { createTerminal: vi.fn() } as any
		const manager = new AcpTerminalManager(connection, { terminal: true }, () => undefined)

		await expect(manager.createTerminal({ command: "pwd" })).rejects.toThrow(/No active ACP session.*terminal/)
		expect(connection.createTerminal).not.toHaveBeenCalled()
	})

	it("propagates advertised terminal request failures", async () => {
		const connection = { createTerminal: vi.fn().mockRejectedValue(new Error("terminal denied")) } as any
		const manager = new AcpTerminalManager(connection, { terminal: true }, () => "session-1")

		await expect(manager.createTerminal({ command: "pwd" })).rejects.toThrow("terminal denied")
	})
})

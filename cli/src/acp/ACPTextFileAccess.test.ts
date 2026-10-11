import { describe, expect, it, vi } from "vitest"
import type { TextFileAccess, TextFileReadResult, TextFileWriteResult } from "@/integrations/editor/TextFileAccess"
import { ACPTextFileAccess } from "./ACPTextFileAccess.js"

class FakeNodeTextFileAccess implements TextFileAccess {
	readonly readText = vi.fn<(path: string) => Promise<TextFileReadResult>>()
	readonly writeText = vi.fn<(path: string, content: string) => Promise<TextFileWriteResult>>()

	constructor() {
		this.readText.mockResolvedValue({ content: "node read", encoding: "windows-1252" })
		this.writeText.mockImplementation(async (_path, content) => ({ content }))
	}
}

function createConnection() {
	return {
		readTextFile: vi.fn().mockResolvedValue({ content: "acp read" }),
		writeTextFile: vi.fn().mockResolvedValue(undefined),
	} as any
}

describe("ACPTextFileAccess", () => {
	it("uses Node for reads and writes when ACP capabilities are absent", async () => {
		const connection = createConnection()
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(connection, {}, () => "session-1", nodeAccess)

		await expect(access.readText("/workspace/file.txt")).resolves.toEqual({
			content: "node read",
			encoding: "windows-1252",
		})
		await expect(access.writeText("/workspace/file.txt", "updated")).resolves.toEqual({ content: "updated" })

		expect(nodeAccess.readText).toHaveBeenCalledWith("/workspace/file.txt")
		expect(nodeAccess.writeText).toHaveBeenCalledWith("/workspace/file.txt", "updated")
		expect(connection.readTextFile).not.toHaveBeenCalled()
		expect(connection.writeTextFile).not.toHaveBeenCalled()
	})

	it("routes ACP reads and Node writes independently", async () => {
		const connection = createConnection()
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: false } },
			() => "session-read",
			nodeAccess,
		)

		await expect(access.readText("/workspace/read.txt")).resolves.toEqual({ content: "acp read", encoding: "utf8" })
		await access.writeText("/workspace/write.txt", "node content")

		expect(connection.readTextFile).toHaveBeenCalledWith({ sessionId: "session-read", path: "/workspace/read.txt" })
		expect(nodeAccess.writeText).toHaveBeenCalledWith("/workspace/write.txt", "node content")
		expect(connection.writeTextFile).not.toHaveBeenCalled()
	})

	it("routes Node reads and ACP writes independently", async () => {
		const connection = createConnection()
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: false, writeTextFile: true } },
			() => "session-write",
			nodeAccess,
		)

		await access.readText("/workspace/read.txt")
		await expect(access.writeText("/workspace/write.txt", "acp content")).resolves.toEqual({ content: "acp content" })

		expect(nodeAccess.readText).toHaveBeenCalledWith("/workspace/read.txt")
		expect(connection.writeTextFile).toHaveBeenCalledWith({
			sessionId: "session-write",
			path: "/workspace/write.txt",
			content: "acp content",
		})
		expect(connection.readTextFile).not.toHaveBeenCalled()
	})

	it("reads back ACP writes when both capabilities are advertised", async () => {
		const connection = createConnection()
		connection.readTextFile.mockResolvedValue({ content: "formatted content" })
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: true } },
			() => "session-both",
			nodeAccess,
		)

		await expect(access.writeText("/workspace/file.txt", "submitted content")).resolves.toEqual({
			content: "formatted content",
		})
		expect(connection.writeTextFile).toHaveBeenCalledWith({
			sessionId: "session-both",
			path: "/workspace/file.txt",
			content: "submitted content",
		})
		expect(connection.readTextFile).toHaveBeenCalledWith({
			sessionId: "session-both",
			path: "/workspace/file.txt",
		})
		expect(connection.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
			connection.readTextFile.mock.invocationCallOrder[0],
		)
		expect(nodeAccess.writeText).not.toHaveBeenCalled()
	})

	it("rejects before an ACP request when no session is active", async () => {
		const connection = createConnection()
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: true } },
			() => undefined,
			nodeAccess,
		)

		await expect(access.readText("/workspace/file.txt")).rejects.toThrow(/No active ACP session.*reading/)
		await expect(access.writeText("/workspace/file.txt", "content")).rejects.toThrow(/No active ACP session.*writing/)
		expect(connection.readTextFile).not.toHaveBeenCalled()
		expect(connection.writeTextFile).not.toHaveBeenCalled()
		expect(nodeAccess.readText).not.toHaveBeenCalled()
		expect(nodeAccess.writeText).not.toHaveBeenCalled()
	})

	it("propagates advertised ACP failures without invoking Node fallback", async () => {
		const connection = createConnection()
		connection.readTextFile.mockRejectedValue(new Error("client read denied"))
		connection.writeTextFile.mockRejectedValue(new Error("client write denied"))
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: true } },
			() => "session-1",
			nodeAccess,
		)

		await expect(access.readText("/workspace/file.txt")).rejects.toThrow("client read denied")
		await expect(access.writeText("/workspace/file.txt", "content")).rejects.toThrow("client write denied")
		expect(nodeAccess.readText).not.toHaveBeenCalled()
		expect(nodeAccess.writeText).not.toHaveBeenCalled()
	})

	it("propagates ACP read-back failure without invoking Node fallback", async () => {
		const connection = createConnection()
		connection.readTextFile.mockRejectedValue(new Error("read-back failed"))
		const nodeAccess = new FakeNodeTextFileAccess()
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: true } },
			() => "session-1",
			nodeAccess,
		)

		await expect(access.writeText("/workspace/file.txt", "content")).rejects.toThrow("read-back failed")
		expect(connection.writeTextFile).toHaveBeenCalledOnce()
		expect(nodeAccess.writeText).not.toHaveBeenCalled()
	})

	it("resolves the active session for every operation", async () => {
		const connection = createConnection()
		const nodeAccess = new FakeNodeTextFileAccess()
		let sessionId = "session-a"
		const resolver = vi.fn(() => sessionId)
		const access = new ACPTextFileAccess(connection, { fs: { readTextFile: true } }, resolver, nodeAccess)

		await access.readText("/workspace/a.txt")
		sessionId = "session-b"
		await access.readText("/workspace/b.txt")

		expect(resolver).toHaveBeenCalledTimes(2)
		expect(connection.readTextFile).toHaveBeenNthCalledWith(1, { sessionId: "session-a", path: "/workspace/a.txt" })
		expect(connection.readTextFile).toHaveBeenNthCalledWith(2, { sessionId: "session-b", path: "/workspace/b.txt" })
	})

	it("rejects read-back if the active session changes while a write is pending", async () => {
		const connection = createConnection()
		let completeWrite!: () => void
		connection.writeTextFile.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					completeWrite = resolve
				}),
		)
		const nodeAccess = new FakeNodeTextFileAccess()
		let sessionId = "session-a"
		const access = new ACPTextFileAccess(
			connection,
			{ fs: { readTextFile: true, writeTextFile: true } },
			() => sessionId,
			nodeAccess,
		)

		const write = access.writeText("/workspace/file.txt", "content")
		expect(connection.writeTextFile).toHaveBeenCalledWith({
			sessionId: "session-a",
			path: "/workspace/file.txt",
			content: "content",
		})
		sessionId = "session-b"
		completeWrite()

		await expect(write).rejects.toThrow(/session changed.*cross-session read-back/i)
		expect(connection.readTextFile).not.toHaveBeenCalled()
		expect(nodeAccess.readText).not.toHaveBeenCalled()
	})

})

import type * as acp from "@agentclientprotocol/sdk"
import { describe, expect, it, vi } from "vitest"
import { ACPHostBridgeClientProvider } from "./ACPHostBridgeClientProvider.js"

function createProvider(options?: {
	sessionId?: string
	clientCapabilities?: acp.ClientCapabilities
	emitSessionUpdate?: (sessionId: string, update: acp.SessionUpdate) => Promise<void>
}) {
	return new ACPHostBridgeClientProvider(
		undefined,
		options?.clientCapabilities ?? {},
		() => options?.sessionId,
		() => "/workspace",
		options?.emitSessionUpdate,
		"1.2.3",
	)
}

describe("ACPHostBridgeClientProvider workspace service", () => {
	it("allows the edit preflight when ACP file reads and writes are negotiated", async () => {
		const workspace = createProvider({
			clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
		}).workspaceClient

		await expect(workspace.saveOpenDocumentIfDirty({ filePath: "/workspace/file.ts" })).resolves.toEqual({})
	})

	it("rejects the edit preflight without complete ACP file access", async () => {
		const incompleteCapabilities: acp.ClientCapabilities[] = [
			{},
			{ fs: { readTextFile: true, writeTextFile: false } },
			{ fs: { readTextFile: false, writeTextFile: true } },
		]

		for (const clientCapabilities of incompleteCapabilities) {
			const workspace = createProvider({ clientCapabilities }).workspaceClient
			await expect(workspace.saveOpenDocumentIfDirty({ filePath: "/workspace/file.ts" })).rejects.toThrow(
				"fs.readTextFile and fs.writeTextFile",
			)
		}
	})
})

describe("ACPHostBridgeClientProvider diff service", () => {
	it("rejects every legacy ACP diff document operation with actionable guidance", async () => {
		const diff = createProvider({ sessionId: "session-1" }).diffClient
		const operations: Array<[string, Promise<unknown>]> = [
			["openDiff", diff.openDiff({} as any)],
			["getDocumentText", diff.getDocumentText({} as any)],
			["replaceText", diff.replaceText({} as any)],
			["scrollDiff", diff.scrollDiff({} as any)],
			["truncateDocument", diff.truncateDocument({} as any)],
			["saveDocument", diff.saveDocument({} as any)],
			["closeAllDiffs", diff.closeAllDiffs({} as any)],
		]

		for (const [operation, promise] of operations) {
			await expect(promise).rejects.toThrow(operation)
			await expect(promise).rejects.toThrow("FileEditProvider with ACPTextFileAccess")
		}
	})

	it("requires an active session for multi-file presentation", async () => {
		const emit = vi.fn().mockResolvedValue(undefined)
		const diff = createProvider({ emitSessionUpdate: emit }).diffClient

		await expect(
			diff.openMultiFileDiff({
				title: "Changes",
				diffs: [{ filePath: "/workspace/a.ts", leftContent: "old", rightContent: "new" }],
			} as any),
		).rejects.toThrow(/No active ACP session.*multi-file diff/)
		expect(emit).not.toHaveBeenCalled()
	})

	it("rejects empty input and missing file paths", async () => {
		const emit = vi.fn().mockResolvedValue(undefined)
		const diff = createProvider({ sessionId: "session-1", emitSessionUpdate: emit }).diffClient

		await expect(diff.openMultiFileDiff({ title: "Changes", diffs: [] } as any)).rejects.toThrow("at least one diff")
		await expect(
			diff.openMultiFileDiff({ title: "Changes", diffs: [{ leftContent: "", rightContent: "new" }] } as any),
		).rejects.toThrow("missing file path")
		expect(emit).not.toHaveBeenCalled()
	})

	it("emits one completed edit tool call containing every diff and location", async () => {
		const emit = vi.fn().mockResolvedValue(undefined)
		const diff = createProvider({ sessionId: "session-7", emitSessionUpdate: emit }).diffClient

		await expect(
			diff.openMultiFileDiff({
				title: "Review all changes",
				diffs: [
					{ filePath: "/workspace/a.ts", leftContent: "", rightContent: "new a" },
					{ filePath: "/workspace/b.ts", leftContent: "old b", rightContent: "" },
				],
			} as any),
		).resolves.toEqual({})

		expect(emit).toHaveBeenCalledOnce()
		const [sessionId, update] = emit.mock.calls[0]
		expect(sessionId).toBe("session-7")
		expect(update).toMatchObject({
			sessionUpdate: "tool_call",
			name: "open_multi_file_diff",
			title: "Review all changes",
			kind: "edit",
			status: "completed",
			content: [
				{ type: "diff", path: "/workspace/a.ts", oldText: "", newText: "new a" },
				{ type: "diff", path: "/workspace/b.ts", oldText: "old b", newText: "" },
			],
			locations: [{ path: "/workspace/a.ts" }, { path: "/workspace/b.ts" }],
			rawInput: { title: "Review all changes", fileCount: 2 },
		})
		expect(update.toolCallId).toEqual(expect.any(String))
	})

	it("propagates emitter failure and waits for emitter completion", async () => {
		let release!: () => void
		const delivery = new Promise<void>((resolve) => {
			release = resolve
		})
		const emit = vi.fn(() => delivery)
		const diff = createProvider({ sessionId: "session-1", emitSessionUpdate: emit }).diffClient
		let settled = false
		const presentation = diff
			.openMultiFileDiff({
				title: "Changes",
				diffs: [{ filePath: "/workspace/a.ts", leftContent: "old", rightContent: "new" }],
			} as any)
			.then(() => {
				settled = true
			})

		await Promise.resolve()
		expect(settled).toBe(false)
		release()
		await presentation
		expect(settled).toBe(true)

		const failingDiff = createProvider({
			sessionId: "session-1",
			emitSessionUpdate: vi.fn().mockRejectedValue(new Error("delivery failed")),
		}).diffClient
		await expect(
			failingDiff.openMultiFileDiff({
				title: "Changes",
				diffs: [{ filePath: "/workspace/a.ts", leftContent: "old", rightContent: "new" }],
			} as any),
		).rejects.toThrow("delivery failed")
	})

	it("uses the connection as the presentation emitter when no emitter is injected", async () => {
		const connection = { sessionUpdate: vi.fn().mockResolvedValue(undefined) } as any
		const provider = new ACPHostBridgeClientProvider(
			connection,
			{},
			() => "session-connection",
			() => "/workspace",
			undefined,
			"1.2.3",
		)

		await provider.diffClient.openMultiFileDiff({
			title: "Changes",
			diffs: [{ filePath: "/workspace/a.ts", leftContent: "old", rightContent: "new" }],
		} as any)
		expect(connection.sessionUpdate).toHaveBeenCalledWith({
			sessionId: "session-connection",
			update: expect.objectContaining({ sessionUpdate: "tool_call", status: "completed" }),
		})
	})
})

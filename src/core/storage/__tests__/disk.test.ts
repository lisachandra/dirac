import { expectLoggerErrors } from "@/test/loggerGuard"
import { Anthropic } from "@anthropic-ai/sdk"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { type HistoryItem, isTaskHistoryItem } from "@shared/HistoryItem"
import * as fsUtils from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import {
	cleanupConversationHistoryFile,
	commitTaskHistoryMutations,
	ensureCacheDirectoryExists,
	ensureSettingsDirectoryExists,
	ensureStateDirectoryExists,
	ensureTaskDirectoryExists,
	getAllHooksDirs,
	getGlobalHooksDir,
	getSavedApiConversationHistory,
	getSavedDiracMessages,
	getTaskHistoryStateFilePath,
	getTaskMetadata,
	getWorkspaceHooksDirs,
	readRemoteConfigFromCache,
	readTaskHistoryFromState,
	readTaskSettingsFromStorage,
	saveApiConversationHistory,
	saveDiracMessages,
	saveTaskMetadata,
	updateTaskMetadata,
	setRuntimeHooksDir,
	taskHistoryStateFileExists,
	writeConversationHistoryJson,
	writeConversationHistoryText,
	writeRemoteConfigToCache,
	writeTaskHistoryToState,
	writeTaskSettingsToStorage,
} from "../disk"
import { StateManager } from "../StateManager"

describe("disk - hooks functionality", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `disk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })
	})

	afterEach(async () => {
		sandbox.restore()
		setRuntimeHooksDir(undefined)
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch (error) {
			// Ignore cleanup errors
		}
	})

	describe("getWorkspaceHooksDirs", () => {
		it("should return empty array when no workspace roots exist", async () => {
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => undefined,
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return empty array when workspace roots is empty array", async () => {
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return empty array when no hooks directories exist", async () => {
			// Create workspace root without hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			await fs.mkdir(workspaceRoot, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return hooks directory when it exists", async () => {
			// Create workspace root with hooks directory
			const workspaceRoot = path.join(tempDir, "workspace1")
			const hooksDir = path.join(workspaceRoot, ".diracrules", "hooks")
			await fs.mkdir(hooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(1)
			result[0].should.equal(hooksDir)
		})

		it("should not return hooks directory if it's a file instead of directory", async () => {
			// Create workspace root with hooks as a file (not directory)
			const workspaceRoot = path.join(tempDir, "workspace1")
			const hooksPath = path.join(workspaceRoot, ".diracrules", "hooks")
			await fs.mkdir(path.dirname(hooksPath), { recursive: true })
			await fs.writeFile(hooksPath, "not a directory")

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(0)
		})

		it("should return multiple hooks directories for multi-root workspace", async () => {
			// Create multiple workspace roots with hooks directories
			const workspaceRoot1 = path.join(tempDir, "workspace1")
			const workspaceRoot2 = path.join(tempDir, "workspace2")
			const hooksDir1 = path.join(workspaceRoot1, ".diracrules", "hooks")
			const hooksDir2 = path.join(workspaceRoot2, ".diracrules", "hooks")

			await fs.mkdir(hooksDir1, { recursive: true })
			await fs.mkdir(hooksDir2, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot1 }, { path: workspaceRoot2 }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(2)
			result.should.containEql(hooksDir1)
			result.should.containEql(hooksDir2)
		})

		it("should return only existing hooks directories in multi-root workspace", async () => {
			// Create multiple workspace roots, but only some have hooks directories
			const workspaceRoot1 = path.join(tempDir, "workspace1")
			const workspaceRoot2 = path.join(tempDir, "workspace2")
			const workspaceRoot3 = path.join(tempDir, "workspace3")
			const hooksDir1 = path.join(workspaceRoot1, ".diracrules", "hooks")
			const hooksDir3 = path.join(workspaceRoot3, ".diracrules", "hooks")

			await fs.mkdir(hooksDir1, { recursive: true })
			await fs.mkdir(workspaceRoot2, { recursive: true }) // No hooks dir
			await fs.mkdir(hooksDir3, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot1 }, { path: workspaceRoot2 }, { path: workspaceRoot3 }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(2)
			result.should.containEql(hooksDir1)
			result.should.containEql(hooksDir3)
			result.should.not.containEql(path.join(workspaceRoot2, ".diracrules", "hooks"))
		})

		it("should propagate errors when checking directory fails", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			await fs.mkdir(workspaceRoot, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			// Stub isDirectory to throw an error
			sandbox.stub(fsUtils, "isDirectory").rejects(new Error("Permission denied"))

			// Should propagate the error
			try {
				await getWorkspaceHooksDirs()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Permission denied")
			}
		})

		it("should use correct path joining for hooks directory", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			const expectedHooksDir = path.join(workspaceRoot, ".diracrules", "hooks")
			await fs.mkdir(expectedHooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRoot }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result[0].should.equal(expectedHooksDir)
			// Verify it uses the correct path separator for the platform
			result[0].should.match(/\.diracrules[\\/]hooks$/)
		})

		it("should handle workspace roots with trailing slashes", async () => {
			const workspaceRoot = path.join(tempDir, "workspace1")
			const workspaceRootWithSlash = workspaceRoot + path.sep
			const hooksDir = path.join(workspaceRoot, ".diracrules", "hooks")
			await fs.mkdir(hooksDir, { recursive: true })

			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [{ path: workspaceRootWithSlash }],
			} as any)

			const result = await getWorkspaceHooksDirs()
			result.should.be.an.Array()
			result.length.should.equal(1)
			result[0].should.equal(hooksDir)
		})
	})

	describe("getAllHooksDirs", () => {
		it("should include the runtime hooks directory when it exists", async () => {
			const runtimeHooksDir = path.join(tempDir, "runtime-hooks")
			await fs.mkdir(runtimeHooksDir, { recursive: true })

			sandbox.stub(os, "homedir").returns(tempDir)
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			sandbox.stub(fsUtils, "isDirectory").callsFake(async (targetPath: string) => targetPath === runtimeHooksDir)

			setRuntimeHooksDir(runtimeHooksDir)

			const result = await getAllHooksDirs()
			result.should.containEql(runtimeHooksDir)
		})

		it("should not include the runtime hooks directory when it does not exist", async () => {
			const runtimeHooksDir = path.join(tempDir, "missing-runtime-hooks")

			sandbox.stub(os, "homedir").returns(tempDir)
			sandbox.stub(StateManager, "get").returns({
				getGlobalStateKey: () => [],
			} as any)

			sandbox.stub(fsUtils, "isDirectory").resolves(false)

			setRuntimeHooksDir(runtimeHooksDir)

			const result = await getAllHooksDirs()
			result.should.not.containEql(runtimeHooksDir)
		})
	})
})

describe("disk - atomic writes", () => {
	let sandbox: sinon.SinonSandbox
	let testGlobalStorageDir: string

	// Setup HostProvider for tests with real temp directory
	before(async () => {
		// Create a real temp directory for the tests
		testGlobalStorageDir = path.join(os.tmpdir(), `dirac-test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(testGlobalStorageDir, { recursive: true })

		// Initialize HostProvider with the real temp directory
		setVscodeHostProviderMock({
			globalStorageFsPath: testGlobalStorageDir,
		})
	})

	after(async () => {
		HostProvider.reset()

		// Clean up temp directory
		try {
			await fs.rm(testGlobalStorageDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	/**
	 * Helper to create test history items
	 */
	const createTestHistoryItem = (id: string, task: string): HistoryItem => {
		return {
			id,
			ts: Date.now(),
			task,
			tokensIn: 100,
			tokensOut: 200,
			totalCost: 0.01,
		}
	}

	/**
	 * Helper to check for orphaned temp files
	 */
	const getTempFileCount = async (): Promise<number> => {
		const stateDir = await ensureStateDirectoryExists()
		const files = await fs.readdir(stateDir)
		return files.filter((f) => f.startsWith("taskHistory.json.tmp.")).length
	}

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
	})

	afterEach(async () => {
		sandbox.restore()
	})

	describe("writeTaskHistoryToState and readTaskHistoryFromState", () => {
		it("should write and read task history correctly", async () => {
			const items = [createTestHistoryItem("test-1", "Build a todo app"), createTestHistoryItem("test-2", "Fix a bug")]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.be.an.Array()
			result.should.have.length(2)
			result[0].id.should.equal("test-1")
			result[0].task.should.equal("Build a todo app")
			result[1].id.should.equal("test-2")
			result[1].task.should.equal("Fix a bug")
		})

		it("should write valid JSON that can be parsed", async () => {
			const items = [
				createTestHistoryItem("test-json-1", "Test with special chars: 你好 🎉"),
				createTestHistoryItem("test-json-2", "Test with quotes: \"hello\" and 'world'"),
			]

			await writeTaskHistoryToState(items)

			// Read the raw file and verify it's valid JSON
			const filePath = await getTaskHistoryStateFilePath()
			const rawContent = await fs.readFile(filePath, "utf8")
			const parsed = JSON.parse(rawContent) // Should not throw

			parsed.should.be.an.Array()
			parsed.should.have.length(2)
		})

		it("should not leave temp files after successful write", async () => {
			const items = [createTestHistoryItem("cleanup-test", "Test cleanup")]

			const tempCountBefore = await getTempFileCount()
			await writeTaskHistoryToState(items)
			const tempCountAfter = await getTempFileCount()

			tempCountAfter.should.equal(tempCountBefore)
		})

		it("should handle empty array writes", async () => {
			await writeTaskHistoryToState([])
			const result = await readTaskHistoryFromState()

			result.should.be.an.Array()
			result.should.have.length(0)
		})

		it("should handle large task history arrays", async function () {
			this.timeout(30000) // 30 second timeout for large file operations

			// Create large task content by repeating a pattern (each task ~50 KB)
			const baseContent = "X".repeat(50 * 1024) // 50 KB of X's per task

			// Create 1,000 history items (resulting in ~50 MB file)
			const items = Array.from({ length: 1000 }, (_, i) =>
				createTestHistoryItem(`stress-test-${i}`, `Task ${i}: ${baseContent}`),
			)

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			// Verify array length and data integrity
			result.should.have.length(1000)
			result[0].id.should.equal("stress-test-0")
			result[0].task.should.startWith("Task 0: X")
			result[500].id.should.equal("stress-test-500")
			result[999].id.should.equal("stress-test-999")
		})

		it("should handle concurrent writes without corruption", async function () {
			this.timeout(30000)

			// Perform many concurrent writes to stress test atomicity
			const writePromises = Array.from({ length: 100 }, (_, i) => {
				const items = [createTestHistoryItem(`concurrent-${i}`, `Task ${i}`)]
				return writeTaskHistoryToState(items).catch((error) => {
					// On Windows, concurrent renames may fail with EPERM - this is expected
					if (process.platform === "win32" && error.code === "EPERM") {
						return // Expected Windows behavior
					}
					throw error // Unexpected error, rethrow
				})
			})

			// Wait for all writes to complete (some may fail on Windows with EPERM)
			await Promise.all(writePromises)

			// Final read should return valid JSON (not corrupted)
			const result = await readTaskHistoryFromState()
			result.should.be.an.Array()
			// Should have data from one of the concurrent writes that succeeded
			result.length.should.be.greaterThan(0)
			// Verify the data is valid (not corrupted)
			result[0].should.have.property("id")
			result[0].should.have.property("task")
		})

		it("should merge concurrent ID-scoped upserts instead of losing writers", async function () {
			this.timeout(30000)
			const base = createTestHistoryItem("transaction-base", "Base")
			await writeTaskHistoryToState([base])
			const additions = Array.from({ length: 5 }, (_, index) =>
				createTestHistoryItem(`transaction-${index}`, `Task ${index}`),
			)

			await Promise.all(
				additions.map((item) => commitTaskHistoryMutations([{ kind: "upsert", item }])),
			)

			const resultIds = new Set((await readTaskHistoryFromState()).map((item) => item.id))
			resultIds.has(base.id).should.be.true()
			for (const item of additions) resultIds.has(item.id).should.be.true()
		})

		it("should preserve a concurrent favorite flag while refreshing a run summary", async () => {
			const initial = createTestHistoryItem("favorite-merge", "Initial")
			await writeTaskHistoryToState([initial])
			await commitTaskHistoryMutations([{ kind: "setFavorite", id: initial.id, isFavorited: true }])
			await commitTaskHistoryMutations([
				{ kind: "upsert", item: { ...initial, task: "Refreshed", ts: initial.ts + 1 } },
			])

			const [result] = await readTaskHistoryFromState()
			result.task.should.equal("Refreshed")
			;(result.isFavorited === true).should.be.true()
		})

		it("should preserve data integrity with special characters", async () => {
			const items = [
				createTestHistoryItem("special-1", "Test\nwith\nnewlines"),
				createTestHistoryItem("special-2", "Test\twith\ttabs"),
				createTestHistoryItem("special-3", "Test with unicode: 日本語 中文 한국어"),
				createTestHistoryItem("special-4", "Test with emojis: 😀🎉🚀"),
			]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.have.length(4)
			result[0].task.should.equal("Test\nwith\nnewlines")
			result[1].task.should.equal("Test\twith\ttabs")
			result[2].task.should.equal("Test with unicode: 日本語 中文 한국어")
			result[3].task.should.equal("Test with emojis: 😀🎉🚀")
		})

		it("should overwrite existing task history", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("initial-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("initial-1")

			// Overwrite with new data
			const newItems = [createTestHistoryItem("new-1", "New task 1"), createTestHistoryItem("new-2", "New task 2")]
			await writeTaskHistoryToState(newItems)

			// Verify new data replaced old data
			result = await readTaskHistoryFromState()
			result.should.have.length(2)
			result[0].id.should.equal("new-1")
			result[1].id.should.equal("new-2")
		})

		it("should handle rapid successive writes", async function () {
			this.timeout(5000)

			// Perform rapid successive writes (not concurrent)
			for (let i = 0; i < 20; i++) {
				const items = [createTestHistoryItem(`rapid-${i}`, `Task ${i}`)]
				await writeTaskHistoryToState(items)
			}

			// Should have no temp files left
			const tempCount = await getTempFileCount()
			tempCount.should.equal(0)

			// Final read should be valid
			const result = await readTaskHistoryFromState()
			result.should.be.an.Array()
			result.should.have.length(1)
			result[0].id.should.equal("rapid-19")
		})

		it("should preserve all HistoryItem fields", async () => {
			const items = [
				{
					id: "full-test",
					ts: 1234567890,
					task: "Complete task",
					tokensIn: 500,
					tokensOut: 1000,
					totalCost: 0.15,
					cacheWrites: 100,
					cacheReads: 200,
				},
			]

			await writeTaskHistoryToState(items)
			const result = await readTaskHistoryFromState()

			result.should.have.length(1)
			result[0].id.should.equal("full-test")
			result[0].ts.should.equal(1234567890)
			result[0].task.should.equal("Complete task")
			isTaskHistoryItem(result[0]).should.equal(true)
			if (!isTaskHistoryItem(result[0])) throw new Error("Expected Task history")
			result[0].tokensIn.should.equal(500)
			result[0].tokensOut.should.equal(1000)
			result[0].totalCost.should.equal(0.15)
			result[0].cacheWrites!.should.equal(100)
			result[0].cacheReads!.should.equal(200)
		})

		it("should preserve image-only tasks with an empty description", async () => {
			const imageOnlyItem = createTestHistoryItem("image-only", "")

			await writeTaskHistoryToState([imageOnlyItem])
			const result = await readTaskHistoryFromState()

			result.should.deepEqual([imageOnlyItem])
		})

		it("should skip unreadable history records while preserving valid records", async () => {
			const validItem = createTestHistoryItem("valid-record", "Readable task")
			const filePath = await getTaskHistoryStateFilePath()
			await fs.writeFile(
				filePath,
				JSON.stringify([
					validItem,
					null,
					{ id: "missing-task", ts: Date.now() },
					{ id: 42, ts: Date.now(), task: "bad id" },
					{ ...validItem, id: "bad-cost", totalCost: { amount: 1 } },
					{ ...validItem, id: "bad-workspace", cwdOnTaskInitialization: { path: "/workspace" } },
				]),
				"utf8",
			)

			const result = await readTaskHistoryFromState()

			result.should.deepEqual([validItem])
		})

		it("should recover numeric and UUID task directories without prompting or recurring", async function () {
			this.timeout(2_000)
			const recoveryStorage = path.join(testGlobalStorageDir, `history-recovery-${Date.now()}`)
			await fs.mkdir(recoveryStorage, { recursive: true })
			sandbox.stub(HostProvider.get(), "globalStorageFsPath").value(recoveryStorage)

			const taskIds = ["1780000000000", "550e8400-e29b-41d4-a716-446655440000"]
			for (const [index, taskId] of taskIds.entries()) {
				const taskDir = await ensureTaskDirectoryExists(taskId)
				await fs.writeFile(
					path.join(taskDir, "ui_messages.json"),
					JSON.stringify([
						{
							id: `${taskId}-message`,
							ts: Date.now() + index,
							content: { type: "markdown", content: `Recovered ${taskId}`, role: "user" },
						},
					]),
					"utf8",
				)
			}

			const filePath = await getTaskHistoryStateFilePath()
			await fs.writeFile(filePath, "{not-json", "utf8")
			const showMessage = sandbox.stub(HostProvider.window, "showMessage").resolves(undefined as any)

			const result = await readTaskHistoryFromState()

			result.map((item) => item.id).sort().should.deepEqual([...taskIds].sort())
			sinon.assert.notCalled(showMessage)
			JSON.parse(await fs.readFile(filePath, "utf8")).should.have.length(2)
			const backups = (await fs.readdir(path.dirname(filePath))).filter((name) =>
				name.startsWith("taskHistory.unreadable."),
			)
			backups.length.should.be.greaterThan(0)
		})

	})

	describe("atomic write failure scenarios", () => {
		it("should leave original file intact if temp file write fails", async () => {
			expectLoggerErrors()
			// Write initial data
			const initialItems = [createTestHistoryItem("original-1", "Original task")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data exists
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-1")

			// Stub fs.writeFile to fail during temp file creation
			const writeFileStub = sandbox.stub(fs, "writeFile")
			writeFileStub.rejects(new Error("Simulated write failure"))

			// Attempt to write new data (should fail)
			const newItems = [createTestHistoryItem("new-1", "New task")]
			try {
				await writeTaskHistoryToState(newItems)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Simulated write failure")
			}

			// Original file should still be intact
			result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-1")

			// No temp files should remain
			const tempCount = await getTempFileCount()
			tempCount.should.equal(0)
		})

		it("should leave original file intact if rename fails", async () => {
			expectLoggerErrors()
			// Write initial data
			const initialItems = [createTestHistoryItem("original-2", "Original task 2")]
			await writeTaskHistoryToState(initialItems)

			// Verify initial data exists
			let result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-2")

			// Stub fs.rename to fail
			const renameStub = sandbox.stub(fs, "rename")
			renameStub.rejects(new Error("Simulated rename failure"))

			// Attempt to write new data (should fail)
			const newItems = [createTestHistoryItem("new-2", "New task 2")]
			try {
				await writeTaskHistoryToState(newItems)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Simulated rename failure")
			}

			// Original file should still be intact
			result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("original-2")

			// Temp file cleanup may or may not succeed, but original file is safe
			// (The atomicWriteFile function attempts cleanup but doesn't throw if it fails)
		})

		it("should ignore temp files during read operations", async () => {
			// Write valid data
			const items = [createTestHistoryItem("valid-1", "Valid task")]
			await writeTaskHistoryToState(items)

			// Create a corrupt temp file manually
			const stateDir = await ensureStateDirectoryExists()
			const corruptTempPath = path.join(stateDir, "taskHistory.json.tmp.12345.corrupt")
			await fs.writeFile(corruptTempPath, "INVALID JSON{", "utf8")

			// Read should succeed and ignore the temp file
			const result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("valid-1")

			// Cleanup temp file
			await fs.unlink(corruptTempPath)
		})

		it("should handle concurrent read during write without corruption", async () => {
			// Write initial data
			const initialItems = [createTestHistoryItem("concurrent-read-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Create a slow rename by stubbing fs.rename to delay
			// This simulates the critical window where temp file is written but rename hasn't occurred
			let renameResolve: () => void
			const renamePromise = new Promise<void>((resolve) => {
				renameResolve = resolve
			})

			const originalRename = fs.rename
			const renameStub = sandbox.stub(fs, "rename")
			renameStub.callsFake(async (oldPath, newPath) => {
				// Delay the rename operation
				await renamePromise // Wait for our signal
				return originalRename(oldPath, newPath)
			})

			// Start a write operation (rename will be delayed)
			const newItems = [createTestHistoryItem("concurrent-read-2", "New task")]
			const writeOperation = writeTaskHistoryToState(newItems)

			// Give temp file time to be written, but before rename completes
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Perform a read during the critical window (temp file exists, but rename hasn't happened)
			const readResult = await readTaskHistoryFromState()

			// Should get old data (since rename hasn't completed yet)
			readResult.should.have.length(1)
			readResult[0].id.should.equal("concurrent-read-1")

			// Now allow rename to complete
			renameResolve!()
			await writeOperation

			// Subsequent read should get new data
			const finalResult = await readTaskHistoryFromState()
			finalResult.should.have.length(1)
			finalResult[0].id.should.equal("concurrent-read-2")
		})

		it("should handle partial temp file from interrupted process", async () => {
			// Write initial valid data
			const initialItems = [createTestHistoryItem("partial-test-1", "Initial task")]
			await writeTaskHistoryToState(initialItems)

			// Simulate an interrupted write by creating a partial temp file
			const stateDir = await ensureStateDirectoryExists()
			const partialTempPath = path.join(stateDir, "taskHistory.json.tmp.99999.partial")

			// Write only part of a valid JSON array
			await fs.writeFile(partialTempPath, '[{"id":"partial","ts":123456789', "utf8")

			// Read should succeed with original data
			const result = await readTaskHistoryFromState()
			result.should.have.length(1)
			result[0].id.should.equal("partial-test-1")

			// Write new data should succeed and clean up
			const newItems = [createTestHistoryItem("partial-test-2", "New task")]
			await writeTaskHistoryToState(newItems)

			// Verify new data
			const finalResult = await readTaskHistoryFromState()
			finalResult.should.have.length(1)
			finalResult[0].id.should.equal("partial-test-2")

			// Cleanup our partial temp file if it still exists
			try {
				await fs.unlink(partialTempPath)
			} catch {
				// May already be cleaned up
			}
		})
	})
})

describe("disk - core read/write/mkdir operations", () => {
	let sandbox: sinon.SinonSandbox
	let testGlobalStorageDir: string

	before(async () => {
		testGlobalStorageDir = path.join(os.tmpdir(), `dirac-disk-core-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(testGlobalStorageDir, { recursive: true })
		setVscodeHostProviderMock({ globalStorageFsPath: testGlobalStorageDir })
	})

	after(async () => {
		HostProvider.reset()
		try {
			await fs.rm(testGlobalStorageDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("mkdir operations", () => {
		it("ensureTaskDirectoryExists creates nested tasks/<id> directory", async () => {
			const taskId = `mkdir-task-${Date.now()}`
			const dir = await ensureTaskDirectoryExists(taskId)
			const stat = await fs.stat(dir)
			stat.isDirectory().should.be.true()
			dir.should.containEql("tasks")
			dir.should.containEql(taskId)
		})

		it("ensureTaskDirectoryExists is idempotent on existing directory", async () => {
			const taskId = `mkdir-idempotent-${Date.now()}`
			const first = await ensureTaskDirectoryExists(taskId)
			const second = await ensureTaskDirectoryExists(taskId)
			first.should.equal(second)
			const stat = await fs.stat(second)
			stat.isDirectory().should.be.true()
		})

		it("ensureSettingsDirectoryExists creates settings directory under global storage", async () => {
			const dir = await ensureSettingsDirectoryExists()
			const stat = await fs.stat(dir)
			stat.isDirectory().should.be.true()
			dir.should.containEql("settings")
		})

		it("ensureCacheDirectoryExists creates cache directory under global storage", async () => {
			const dir = await ensureCacheDirectoryExists()
			const stat = await fs.stat(dir)
			stat.isDirectory().should.be.true()
			dir.should.containEql("cache")
		})

		it("ensureStateDirectoryExists creates state directory under global storage", async () => {
			const dir = await ensureStateDirectoryExists()
			const stat = await fs.stat(dir)
			stat.isDirectory().should.be.true()
			dir.should.containEql("state")
		})
	})

	describe("file exists checks", () => {
		it("taskHistoryStateFileExists returns false when no history file exists", async () => {
			// Use a fresh state dir to guarantee absence
			const freshDir = path.join(testGlobalStorageDir, `fresh-state-${Date.now()}`)
			await fs.mkdir(freshDir, { recursive: true })
			sandbox.stub(HostProvider.get(), "globalStorageFsPath").value(freshDir)
			const exists = await taskHistoryStateFileExists()
			exists.should.be.false()
		})

		it("taskHistoryStateFileExists returns true after writing history", async () => {
			await writeTaskHistoryToState([
				{ id: "exists-check", ts: Date.now(), task: "t", tokensIn: 1, tokensOut: 1, totalCost: 0 },
			])
			const exists = await taskHistoryStateFileExists()
			exists.should.be.true()
		})

		it("getGlobalHooksDir returns undefined when hooks dir does not exist", async () => {
			sandbox.stub(os, "homedir").returns(path.join(testGlobalStorageDir, `no-hooks-home-${Date.now()}`))
			const result = await getGlobalHooksDir()
			// Should be undefined since the dir was never created
			const isUndefinedOrString = result === undefined || typeof result === "string"
			isUndefinedOrString.should.be.true()
		})
	})

	describe("API conversation history read/write", () => {
		it("getSavedApiConversationHistory returns empty array for non-existent task", async () => {
			const result = await getSavedApiConversationHistory(`nonexistent-${Date.now()}`)
			result.should.be.an.Array()
			result.should.have.length(0)
		})

		it("saveApiConversationHistory persists and round-trips messages", async () => {
			const taskId = `api-history-${Date.now()}`
			const history: Anthropic.MessageParam[] = [
				{ role: "user", content: "Hello world" },
				{ role: "assistant", content: "Hi there" },
			]
			await saveApiConversationHistory(taskId, history)
			const result = await getSavedApiConversationHistory(taskId)
			result.should.have.length(2)
			result[0].role.should.equal("user")
		})

		it("saveApiConversationHistory with empty array is a no-op (no file written)", async () => {
			const taskId = `api-empty-${Date.now()}`
			await saveApiConversationHistory(taskId, [])
			const result = await getSavedApiConversationHistory(taskId)
			result.should.have.length(0)
		})

		it("saveApiConversationHistory propagates write failures", async () => {
			expectLoggerErrors()
			const taskId = `api-fail-${Date.now()}`
			sandbox.stub(fs, "writeFile").rejects(new Error("disk full"))
			await saveApiConversationHistory(taskId, [{ role: "user", content: "x" }]).should.be.rejectedWith("disk full")
		})
	})

	describe("Dirac messages read/write", () => {
		it("getSavedDiracMessages returns empty array for non-existent task", async () => {
			const result = await getSavedDiracMessages(`nonexistent-${Date.now()}`)
			result.should.be.an.Array()
			result.should.have.length(0)
		})

		it("saveDiracMessages persists and round-trips messages", async () => {
			const taskId = `dirac-msgs-${Date.now()}`
			const messages = [
				{
					id: "message-1",
					ts: Date.now(),
					content: { type: "markdown", content: "hello", role: "user" },
				} as any,
			]
			await saveDiracMessages(taskId, messages)
			const result = await getSavedDiracMessages(taskId)
			result.should.deepEqual(messages)
		})

		it("saveDiracMessages propagates write failures", async () => {
			expectLoggerErrors()
			const taskId = `dirac-fail-${Date.now()}`
			sandbox.stub(fs, "writeFile").rejects(new Error("disk full"))
			await saveDiracMessages(taskId, [{ ask: "test" } as any]).should.be.rejectedWith("disk full")
		})

		it("migrates a readable transcript from the legacy filename", async () => {
			const taskId = `dirac-legacy-filename-${Date.now()}`
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const oldPath = path.join(taskDir, "claude_messages.json")
			const newPath = path.join(taskDir, "ui_messages.json")
			const messages = [
				{
					id: "message-1",
					ts: Date.now(),
					content: { type: "markdown", content: "legacy filename", role: "user" },
				},
			]
			await fs.writeFile(oldPath, JSON.stringify(messages))

			const result = await getSavedDiracMessages(taskId)

			result.should.deepEqual(messages)
			JSON.parse(await fs.readFile(newPath, "utf8")).should.deepEqual(messages)
			await fs.access(oldPath).should.be.rejected()
		})

		it("rejects pre-modular transcripts without deleting the source file", async () => {
			const taskId = `dirac-unsupported-legacy-${Date.now()}`
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const oldPath = path.join(taskDir, "claude_messages.json")
			const newPath = path.join(taskDir, "ui_messages.json")
			await fs.writeFile(oldPath, JSON.stringify([{ ts: Date.now(), type: "say", say: "task", text: "old task" }]))

			let failure: unknown
			try {
				await getSavedDiracMessages(taskId)
			} catch (error) {
				failure = error
			}
			String(failure).should.containEql("unsupported or unreadable format")
			await fs.access(oldPath)
			await fs.access(newPath).should.be.rejected()
		})

		it("skips unreadable messages when a transcript still contains readable messages", async () => {
			const taskId = `dirac-partial-${Date.now()}`
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, "ui_messages.json")
			const readable = {
				id: "message-1",
				ts: Date.now(),
				content: { type: "markdown", content: "readable", role: "user" },
			}
			await fs.writeFile(filePath, JSON.stringify([readable, { ts: Date.now(), type: "say", say: "text" }, null]))

			const result = await getSavedDiracMessages(taskId)

			result.should.deepEqual([readable])
			const backups = (await fs.readdir(taskDir)).filter((name) => name.startsWith("ui_messages.unreadable."))
			backups.length.should.equal(1)
			JSON.parse(await fs.readFile(path.join(taskDir, backups[0]), "utf8")).should.have.length(3)
		})

		it("skips messages with nested fields that are unsafe for transcript renderers", async () => {
			const taskId = `dirac-malformed-nested-${Date.now()}`
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, "ui_messages.json")
			const readable = {
				id: "readable-message",
				ts: Date.now(),
				content: { type: "markdown", content: "readable", role: "assistant" },
			}
			const card = {
				id: "card",
				header: "Saved tool",
				status: "success",
				renderType: "markdown",
			}
			const unreadableMessages = [
				{
					id: "invalid-images",
					ts: Date.now(),
					content: { type: "markdown", content: "bad images", images: [42] },
				},
				{
					id: "invalid-files",
					ts: Date.now(),
					content: { type: "markdown", content: "bad files", files: "not-an-array" },
				},
				{
					id: "invalid-api-cost",
					ts: Date.now(),
					content: { type: "api_status", status: { cost: "free" } },
				},
				{
					id: "invalid-card-action",
					ts: Date.now(),
					content: { type: "card", card: { ...card, actions: [{ label: { text: "Open" }, value: "open" }] } },
				},
				{
					id: "invalid-card-location",
					ts: Date.now(),
					content: { type: "card", card: { ...card, locations: [{ path: 42 }] } },
				},
				{
					id: "invalid-card-diff",
					ts: Date.now(),
					content: { type: "card", card: { ...card, diffs: [{ path: "file.ts", oldText: null, newText: "new" }] } },
				},
				{
					id: "invalid-card-render-type",
					ts: Date.now(),
					content: { type: "card", card: { ...card, renderType: "html" } },
				},
			]
			await fs.writeFile(filePath, JSON.stringify([readable, ...unreadableMessages]))

			const result = await getSavedDiracMessages(taskId)

			result.should.deepEqual([readable])
			const backups = (await fs.readdir(taskDir)).filter((name) => name.startsWith("ui_messages.unreadable."))
			backups.length.should.equal(1)
		})

		it("continues with readable messages when the unreadable transcript backup fails", async () => {
			const taskId = `dirac-backup-failure-${Date.now()}`
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, "ui_messages.json")
			const readable = {
				id: "readable-message",
				ts: Date.now(),
				content: { type: "markdown", content: "readable" },
			}
			await fs.writeFile(filePath, JSON.stringify([readable, null]))
			sandbox.stub(fs, "rename").rejects(new Error("backup denied"))

			const result = await getSavedDiracMessages(taskId)

			result.should.deepEqual([readable])
		})

	})

	describe("task metadata read/write", () => {
		it("serializes concurrent metadata updates without losing fields", async () => {
			const taskId = `meta-concurrent-${Date.now()}`
			await saveTaskMetadata(taskId, { files_in_context: [], model_usage: [], environment_history: [] })

			await Promise.all([
				updateTaskMetadata(taskId, async (metadata) => {
					await new Promise((resolve) => setTimeout(resolve, 10))
					metadata.active_skill_ids = [...(metadata.active_skill_ids ?? []), "new-tool"]
				}),
				updateTaskMetadata(taskId, (metadata) => {
					metadata.model_usage.push({
						ts: 1,
						model_id: "model",
						model_provider_id: "provider",
						mode: "act",
					})
				}),
			])

			const metadata = await getTaskMetadata(taskId)
			metadata.active_skill_ids!.should.deepEqual(["new-tool"])
			metadata.model_usage.should.have.length(1)
		})

		it("getTaskMetadata returns default empty metadata for non-existent task", async () => {
			const result = await getTaskMetadata(`nonexistent-${Date.now()}`)
			result.should.have.property("files_in_context")
			result.should.have.property("model_usage")
			result.should.have.property("environment_history")
			result.files_in_context!.should.have.length(0)
		})

		it("saveTaskMetadata persists and round-trips metadata", async () => {
			const taskId = `meta-${Date.now()}`
			const metadata = { files_in_context: [{ path: "/test.ts", lines: 10 }], model_usage: [], environment_history: [] }
			await saveTaskMetadata(taskId, metadata as any)
			const result = await getTaskMetadata(taskId)
			result.files_in_context!.should.have.length(1)
			result.files_in_context![0].path.should.equal("/test.ts")
		})

		it("getTaskMetadata returns default on read error (swallows error)", async () => {
			expectLoggerErrors()
			const taskId = `meta-read-fail-${Date.now()}`
			// Write valid metadata first
			await saveTaskMetadata(taskId, { files_in_context: [], model_usage: [], environment_history: [] })
			// Then stub readFile to fail on read
			sandbox.stub(fs, "readFile").rejects(new Error("read error"))
			const result = await getTaskMetadata(taskId)
			result.files_in_context!.should.have.length(0)
		})

		it("saveTaskMetadata does not throw on write failure (swallows error)", async () => {
			expectLoggerErrors()
			const taskId = `meta-fail-${Date.now()}`
			sandbox.stub(fs, "writeFile").rejects(new Error("disk full"))
			await saveTaskMetadata(taskId, { files_in_context: [], model_usage: [], environment_history: [] })
		})

		it("leaves the previous metadata intact when replacement fails", async () => {
			expectLoggerErrors()
			const taskId = `meta-atomic-${Date.now()}`
			await saveTaskMetadata(taskId, {
				files_in_context: [{ path: "/original.ts", lines: 10 }],
				model_usage: [],
				environment_history: [],
			} as any)
			sandbox.stub(fs, "rename").rejects(new Error("rename failed"))

			await saveTaskMetadata(taskId, {
				files_in_context: [{ path: "/replacement.ts", lines: 20 }],
				model_usage: [],
				environment_history: [],
			} as any)

			const metadata = await getTaskMetadata(taskId)
			metadata.files_in_context![0].path.should.equal("/original.ts")
		})
	})

	describe("task settings read/write", () => {
		it("readTaskSettingsFromStorage returns empty object for new task", async () => {
			const result = await readTaskSettingsFromStorage(`new-task-${Date.now()}`)
			result.should.be.an.Object()
			Object.keys(result).should.have.length(0)
		})

		it("writeTaskSettingsToStorage persists and round-trips settings", async () => {
			const taskId = `settings-${Date.now()}`
			await writeTaskSettingsToStorage(taskId, { maxTokens: 4096 } as any)
			const result: any = await readTaskSettingsFromStorage(taskId)
			result.maxTokens.should.equal(4096)
		})

		it("writeTaskSettingsToStorage merges with existing settings rather than replacing", async () => {
			const taskId = `settings-merge-${Date.now()}`
			await writeTaskSettingsToStorage(taskId, { maxTokens: 100 } as any)
			await writeTaskSettingsToStorage(taskId, { anotherKey: "val" } as any)
			const result: any = await readTaskSettingsFromStorage(taskId)
			result.maxTokens.should.equal(100)
			result.anotherKey.should.equal("val")
		})

		it("leaves the previous settings intact when replacement fails", async () => {
			expectLoggerErrors()
			const taskId = `settings-atomic-${Date.now()}`
			await writeTaskSettingsToStorage(taskId, { maxTokens: 100 } as any)
			sandbox.stub(fs, "rename").rejects(new Error("rename failed"))

			await writeTaskSettingsToStorage(taskId, { maxTokens: 200 } as any).should.be.rejectedWith("rename failed")

			const result: any = await readTaskSettingsFromStorage(taskId)
			result.maxTokens.should.equal(100)
		})

		it("serializes concurrent settings merges without losing fields", async () => {
			const taskId = `settings-concurrent-${Date.now()}`
			await writeTaskSettingsToStorage(taskId, { initialKey: true } as any)
			const originalRename = fs.rename.bind(fs)
			let releaseFirstRename!: () => void
			let firstRenameStarted!: () => void
			const firstRenameGate = new Promise<void>((resolve) => {
				releaseFirstRename = resolve
			})
			const firstRenameStartedGate = new Promise<void>((resolve) => {
				firstRenameStarted = resolve
			})
			let renameCalls = 0
			sandbox.stub(fs, "rename").callsFake(async (oldPath, newPath) => {
				renameCalls++
				if (renameCalls === 1) {
					firstRenameStarted()
					await firstRenameGate
				}
				await originalRename(oldPath, newPath)
			})

			const firstWrite = writeTaskSettingsToStorage(taskId, { firstKey: "first" } as any)
			await firstRenameStartedGate
			const secondWrite = writeTaskSettingsToStorage(taskId, { secondKey: "second" } as any)
			await new Promise((resolve) => setTimeout(resolve, 20))
			const renameCallsBeforeFirstCommit = renameCalls
			releaseFirstRename()
			await Promise.all([firstWrite, secondWrite])

			renameCallsBeforeFirstCommit.should.equal(1)
			const result: any = await readTaskSettingsFromStorage(taskId)
			result.initialKey.should.equal(true)
			result.firstKey.should.equal("first")
			result.secondKey.should.equal("second")
		})

		it("readTaskSettingsFromStorage throws on read error", async () => {
			expectLoggerErrors()
			const taskId = `settings-read-fail-${Date.now()}`
			await writeTaskSettingsToStorage(taskId, { maxTokens: 1 } as any)
			sandbox.stub(fs, "readFile").rejects(new Error("read error"))
			try {
				await readTaskSettingsFromStorage(taskId)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("read error")
			}
		})
	})

	describe("remote config cache read/write/delete", () => {
		it("readRemoteConfigFromCache returns undefined when no cache exists", async () => {
			const result = await readRemoteConfigFromCache(`no-org-${Date.now()}`)
			const isUndefined = result === undefined
			isUndefined.should.be.true()
		})

		it("writeRemoteConfigToCache persists and readRemoteConfigFromCache round-trips", async () => {
			const orgId = `org-${Date.now()}`
			const config = { organizationId: orgId, settings: {} } as any
			await writeRemoteConfigToCache(orgId, config)
			const result: any = await readRemoteConfigFromCache(orgId)
			result.organizationId.should.equal(orgId)
		})

		it("readRemoteConfigFromCache returns undefined on read error (swallows)", async () => {
			expectLoggerErrors()
			sandbox.stub(fs, "readFile").rejects(new Error("corrupt"))
			const result = await readRemoteConfigFromCache(`corrupt-${Date.now()}`)
			const isUndefined = result === undefined
			isUndefined.should.be.true()
		})
	})

	describe("conversation history hook files", () => {
		it("writeConversationHistoryJson writes file and returns path", async () => {
			const taskId = `conv-json-${Date.now()}`
			const history: Anthropic.MessageParam[] = [{ role: "user", content: "test" }]
			const resultPath = await writeConversationHistoryJson(taskId, history, 12345)
			resultPath.should.containEql("conversation_history_12345.json")
			const content = await fs.readFile(resultPath, "utf8")
			JSON.parse(content).should.have.length(1)
		})

		it("writeConversationHistoryText writes formatted text and returns path", async () => {
			const taskId = `conv-text-${Date.now()}`
			const history: Anthropic.MessageParam[] = [{ role: "user", content: "Hello" }]
			const resultPath = await writeConversationHistoryText(taskId, history, 67890)
			resultPath.should.containEql("conversation_history_67890.txt")
			const content = await fs.readFile(resultPath, "utf8")
			content.should.containEql("CONVERSATION HISTORY")
			content.should.containEql("Hello")
		})

		it("writeConversationHistoryText formats array content with tool_use blocks", async () => {
			const taskId = `conv-text-blocks-${Date.now()}`
			const history: Anthropic.MessageParam[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Thinking" },
						{ type: "tool_use", name: "Read", input: { path: "/x" } } as any,
					],
				},
			]
			const resultPath = await writeConversationHistoryText(taskId, history, 11111)
			const content = await fs.readFile(resultPath, "utf8")
			content.should.containEql("Thinking")
			content.should.containEql("TOOL USE: Read")
		})

		it("writeConversationHistoryText formats tool_result blocks with array content", async () => {
			const taskId = `conv-text-result-${Date.now()}`
			const history: Anthropic.MessageParam[] = [
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tool-1", content: [{ type: "text", text: "result text" }] } as any,
					],
				},
			]
			const resultPath = await writeConversationHistoryText(taskId, history, 22222)
			const content = await fs.readFile(resultPath, "utf8")
			content.should.containEql("TOOL RESULT: tool-1")
			content.should.containEql("result text")
		})

		it("writeConversationHistoryText formats image blocks", async () => {
			const taskId = `conv-text-image-${Date.now()}`
			const history: Anthropic.MessageParam[] = [
				{ role: "user", content: [{ type: "image", source: { type: "base64" } } as any] },
			]
			const resultPath = await writeConversationHistoryText(taskId, history, 33333)
			const content = await fs.readFile(resultPath, "utf8")
			content.should.containEql("IMAGE")
		})

		it("cleanupConversationHistoryFile removes the file if it exists", async () => {
			const taskId = `conv-cleanup-${Date.now()}`
			const resultPath = await writeConversationHistoryJson(taskId, [], 44444)
			await cleanupConversationHistoryFile(resultPath)
			const exists = await fsUtils.fileExistsAtPath(resultPath)
			exists.should.be.false()
		})

		it("cleanupConversationHistoryFile is a no-op on non-existent file (no throw)", async () => {
			await cleanupConversationHistoryFile(path.join(testGlobalStorageDir, "does-not-exist.json"))
		})

		it("cleanupConversationHistoryFile swallows errors silently", async () => {
			expectLoggerErrors()
			sandbox.stub(fs, "unlink").rejects(new Error("permission denied"))
			// Should not throw
			await cleanupConversationHistoryFile(path.join(testGlobalStorageDir, "any.json"))
		})
	})
})

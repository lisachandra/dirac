import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { AnchorStateManager } from "@utils/AnchorStateManager"
import { getDelimiter } from "@utils/line-hashing"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { execRipgrep, formatResults, type RipgrepProcessSpawner } from "../index"

let tmpDir: string
const taskId = "ripgrep-anchor-test"

function fakeRipgrepProcess() {
	const stdout = new PassThrough()
	const kill = sinon.stub().returns(true)
	const process = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout,
		stderr: new PassThrough(),
		kill,
	}) as unknown as ReturnType<RipgrepProcessSpawner>
	return { process, stdout, kill }
}

describe("Ripgrep process lifecycle", () => {
	it("resolves capped output without waiting for child close", async () => {
		const { process: child, stdout, kill } = fakeRipgrepProcess()
		const spawnProcess: RipgrepProcessSpawner = () => child
		const pending = execRipgrep(["--json", "needle", "."], undefined, spawnProcess)

		for (let line = 1; line <= 151; line++) stdout.write(`line ${line}\n`)
		const output = await pending

		assert.equal(output.trim().split("\n").length, 150)
		sinon.assert.calledOnce(kill)
	})

	it("kills and rejects a search when its signal is aborted", async () => {
		const { process: child, kill } = fakeRipgrepProcess()
		let markSpawned: (() => void) | undefined
		const spawned = new Promise<void>((resolve) => {
			markSpawned = resolve
		})
		const spawnProcess: RipgrepProcessSpawner = () => {
			markSpawned?.()
			return child
		}
		const controller = new AbortController()
		const reason = new Error("search deadline expired")
		const pending = execRipgrep(["--json", "needle", "."], controller.signal, spawnProcess)
		await spawned

		controller.abort(reason)

		await assert.rejects(pending, (error: unknown) => error === reason)
		sinon.assert.calledOnce(kill)
	})
})

describe("Ripgrep search result anchors", () => {
	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-ripgrep-anchor-"))
		AnchorStateManager.reset(taskId)
	})

	afterEach(async () => {
		AnchorStateManager.reset(taskId)
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("reconciles tracked anchors after the file is rewritten", async () => {
		const filePath = path.join(tmpDir, "target.txt")
		const oldLines = ["old first", "old second"]
		await fs.writeFile(filePath, oldLines.join("\n"))
		const oldAnchors = AnchorStateManager.reconcile(filePath, oldLines, taskId)

		const newLines = ["new first", "new second"]
		await fs.writeFile(filePath, newLines.join("\n"))
		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: "new first\n", isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			true,
		)

		const emittedAnchor = output.match(/^([A-Z][a-zA-Z]*)§new first$/m)?.[1]
		assert.ok(emittedAnchor)
		assert.notEqual(emittedAnchor, oldAnchors[0])
		assert.equal(emittedAnchor, AnchorStateManager.getAnchors(filePath, taskId)?.[0])
	})

	it("does not initialize anchor state for plain search output", async () => {
		const filePath = path.join(tmpDir, "plain.txt")
		await fs.writeFile(filePath, "plain line")

		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: "plain line\n", isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			false,
		)

		assert.ok(output.includes("│plain line"))
		assert.equal(AnchorStateManager.isTracking(filePath, taskId), false)
	})

	it("omits anchored coordinates when the file changed after search", async () => {
		const filePath = path.join(tmpDir, "stale.txt")
		await fs.writeFile(filePath, "current line")

		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: "stale line\n", isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			true,
		)

		assert.ok(output.includes("file changed during search"))
		assert.ok(!output.includes(`${getDelimiter()}stale line`))
	})

	it("emits long anchored source lines without presentation prefixes or trimming", async () => {
		const filePath = path.join(tmpDir, "long.txt")
		const sourceLine = `${"x".repeat(350)}  `
		await fs.writeFile(filePath, sourceLine)

		const output = await formatResults(
			[{ filePath, lines: [{ lineNum: 1, content: `${sourceLine}\n`, isMatch: true }] }],
			1,
			tmpDir,
			taskId,
			true,
		)
		const anchor = AnchorStateManager.getAnchors(filePath, taskId)?.[0]

		assert.ok(anchor)
		assert.ok(output.includes(`${anchor}${getDelimiter()}${sourceLine}`))
		assert.ok(!output.includes(`│${anchor}${getDelimiter()}`))
	})

})

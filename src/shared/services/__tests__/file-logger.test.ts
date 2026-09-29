import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import {
	createRotatingFileLogger,
	LOG_MAX_AGE_MS,
	LOG_MAX_FILE_SIZE_BYTES,
	LOG_MAX_FILES,
	prepareLogDirectory,
	resolveLogDirectory,
	writeLogEntrySync,
} from "../file-logger"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirac-file-logger-test-"))
	temporaryDirectories.push(directory)
	return directory
}

function familyPaths(logDir: string, baseName: string): string[] {
	const parsed = path.parse(baseName)
	return [
		path.join(logDir, baseName),
		...Array.from({ length: LOG_MAX_FILES - 1 }, (_, index) => path.join(logDir, `${parsed.name}.${index + 1}${parsed.ext}`)),
	].filter((filePath) => fs.existsSync(filePath))
}

/** Plant a lock directory old enough to be considered stale, with the given owner.json contents. */
function plantStaleLock(logDir: string, name: string, ownerContent: string): void {
	const lockPath = path.join(logDir, name)
	fs.mkdirSync(lockPath)
	fs.writeFileSync(path.join(lockPath, "owner.json"), ownerContent)
	const staleAt = new Date(Date.now() - 120_000)
	fs.utimesSync(lockPath, staleAt, staleAt)
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true })
	}
})

describe("persistent file logger", () => {
	it("rotates at 2 MiB and retains five files total", async () => {
		const logDir = createTemporaryDirectory()
		const logger = createRotatingFileLogger({ logDir, fileName: "dirac-cli.log" })

		for (let index = 0; index < 6; index++) {
			logger.write(`record-${index}-${"x".repeat(1_100_000)}`)
		}
		await logger.dispose()

		const files = familyPaths(logDir, "dirac-cli.log")
		assert.equal(files.length, LOG_MAX_FILES)
		for (const filePath of files) {
			assert.ok(fs.statSync(filePath).size <= LOG_MAX_FILE_SIZE_BYTES)
		}
		assert.match(fs.readFileSync(path.join(logDir, "dirac-cli.log"), "utf8"), /record-5-/)
		assert.match(fs.readFileSync(path.join(logDir, "dirac-cli.4.log"), "utf8"), /record-1-/)
		assert.ok(
			!files
				.map((filePath) => fs.readFileSync(filePath, "utf8"))
				.join("")
				.includes("record-0-"),
		)
	})
	it("prefixes every physical line in asynchronous records with an ISO UTC timestamp", async () => {
		const logDir = createTemporaryDirectory()
		const logger = createRotatingFileLogger({ logDir, fileName: "dirac-ext.log" })

		logger.write("INFO first line\n  at stack frame\n\nINFO final line")
		await logger.dispose()

		const lines = fs.readFileSync(path.join(logDir, "dirac-ext.log"), "utf8").trimEnd().split("\n")
		const timestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) /
		const timestamps = lines.map((line) => line.match(timestampPattern)?.[1])
		assert.ok(timestamps.every(Boolean))
		assert.equal(new Set(timestamps).size, 1)
		assert.deepEqual(
			lines.map((line) => line.replace(timestampPattern, "")),
			["INFO first line", "  at stack frame", "", "INFO final line"],
		)
	})

	it("prefixes every physical line in synchronous records with an ISO UTC timestamp", () => {
		const logDir = createTemporaryDirectory()
		writeLogEntrySync({ logDir, fileName: "crash.log" }, "fatal error\n  at crash frame")

		const lines = fs.readFileSync(path.join(logDir, "crash.log"), "utf8").trimEnd().split("\n")
		const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /
		assert.ok(lines.every((line) => timestampPattern.test(line)))
	})

	it("truncates an oversized UTF-8 record within the file limit", async () => {
		const logDir = createTemporaryDirectory()
		const logger = createRotatingFileLogger({ logDir, fileName: "dirac-cli.log" })

		logger.write("🙂".repeat(LOG_MAX_FILE_SIZE_BYTES))
		await logger.dispose()

		const activePath = path.join(logDir, "dirac-cli.log")
		assert.ok(fs.statSync(activePath).size <= LOG_MAX_FILE_SIZE_BYTES)
		assert.match(fs.readFileSync(activePath, "utf8"), /log record truncated from/)

		const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /
		const lines = fs.readFileSync(activePath, "utf8").trimEnd().split("\n")
		assert.ok(lines.every((line) => timestampPattern.test(line)))
	})

	it("lossily divides oversized legacy logs and removes obsolete names", () => {
		const logDir = createTemporaryDirectory()
		const activePath = path.join(logDir, "dirac-ext.log")
		const lines: string[] = ["OLDEST-LEGACY"]
		let bytes = Buffer.byteLength(`${lines[0]}\n`)
		let index = 0
		while (bytes < 12 * 1024 * 1024) {
			const line = `${String(index++).padStart(8, "0")}-${"x".repeat(1000)}`
			lines.push(line)
			bytes += Buffer.byteLength(`${line}\n`)
		}
		lines.push("LATEST-LEGACY")
		fs.writeFileSync(activePath, `${lines.join("\n")}\n`)
		fs.writeFileSync(path.join(logDir, "dirac.1.log"), "obsolete")

		prepareLogDirectory(logDir)

		const files = familyPaths(logDir, "dirac-ext.log")
		assert.ok(files.length <= LOG_MAX_FILES)
		assert.ok(files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0) <= 10 * 1024 * 1024)
		for (const filePath of files) {
			assert.ok(fs.statSync(filePath).size <= LOG_MAX_FILE_SIZE_BYTES)
		}

		const retained = [...files]
			.reverse()
			.map((filePath) => fs.readFileSync(filePath, "utf8"))
			.join("")
		assert.ok(retained.includes("LATEST-LEGACY"))
		assert.ok(!retained.includes("OLDEST-LEGACY"))
		assert.ok(!fs.existsSync(path.join(logDir, "dirac.1.log")))
	})

	it("prunes persistent archives older than 14 days", () => {
		const logDir = createTemporaryDirectory()
		prepareLogDirectory(logDir)

		const activePath = path.join(logDir, "dirac-cli.log")
		const archivePath = path.join(logDir, "dirac-cli.1.log")
		fs.writeFileSync(activePath, "newest\n")
		fs.writeFileSync(archivePath, "expired\n")
		const expiredAt = new Date(Date.now() - LOG_MAX_AGE_MS - 1_000)
		fs.utimesSync(archivePath, expiredAt, expiredAt)

		prepareLogDirectory(logDir)

		assert.equal(fs.readFileSync(activePath, "utf8"), "newest\n")
		assert.ok(!fs.existsSync(archivePath))
	})

	it("reclaims a fresh lock left by a dead process", () => {
		const logDir = createTemporaryDirectory()
		const lockPath = path.join(logDir, ".retention-v1.lock")
		const deadPid = 2_000_000_000
		fs.mkdirSync(lockPath)
		fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: deadPid, token: "dead" }))

		prepareLogDirectory(logDir)

		assert.ok(!fs.existsSync(lockPath))
	})

	it("recovers when a stale lock directory holds a corrupt owner.json", () => {
		const logDir = createTemporaryDirectory()
		plantStaleLock(logDir, ".retention-v1.lock", "")
		plantStaleLock(logDir, ".dirac-cli.log.lock", "{pid:")

		prepareLogDirectory(logDir)

		assert.ok(!fs.existsSync(path.join(logDir, ".retention-v1.lock")))
		assert.ok(!fs.existsSync(path.join(logDir, ".dirac-cli.log.lock")))
	})

	it("uses the documented log-directory precedence", () => {
		const originalLogDir = process.env.DIRAC_LOG_DIR
		const originalDataDir = process.env.DIRAC_DATA_DIR
		const originalDiracDir = process.env.DIRAC_DIR
		try {
			process.env.DIRAC_LOG_DIR = "/explicit/logs"
			process.env.DIRAC_DATA_DIR = "/explicit/data"
			process.env.DIRAC_DIR = "/explicit/home"
			assert.equal(resolveLogDirectory("/resolved/data"), "/explicit/logs")

			delete process.env.DIRAC_LOG_DIR
			assert.equal(resolveLogDirectory("/resolved/data"), path.join("/explicit/data", "logs"))

			delete process.env.DIRAC_DATA_DIR
			assert.equal(resolveLogDirectory(), path.join("/explicit/home", "data", "logs"))
			assert.equal(resolveLogDirectory("/resolved/data"), path.join("/resolved/data", "logs"))
		} finally {
			if (originalLogDir === undefined) delete process.env.DIRAC_LOG_DIR
			else process.env.DIRAC_LOG_DIR = originalLogDir
			if (originalDataDir === undefined) delete process.env.DIRAC_DATA_DIR
			else process.env.DIRAC_DATA_DIR = originalDataDir
			if (originalDiracDir === undefined) delete process.env.DIRAC_DIR
			else process.env.DIRAC_DIR = originalDiracDir
		}
	})
})

import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { toError } from "@/shared/errors"

export const LOG_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
export const LOG_MAX_FILES = 5
export const LOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export const PERSISTENT_LOG_FILE_NAMES = ["dirac-ext.log", "dirac-cli.log", "dirac-acp.log", "crash.log"] as const

const LOG_RETENTION_VERSION = 1
const LOG_RETENTION_MARKER = `.retention-v${LOG_RETENTION_VERSION}`
const LOG_MIGRATION_LOCK = `.retention-v${LOG_RETENTION_VERSION}.lock`
const LOCK_WAIT_TIMEOUT_MS = 10_000
const LOCK_RETRY_MS = 10
const STALE_LOCK_AGE_MS = 60_000

interface FamilyFile {
	path: string
	archiveIndex: number
	mtimeMs: number
	size: number
}

interface MigrationManifest {
	fileName: string
	chunks: Array<{ source: string; target: string }>
}

export interface RotatingFileLogger {
	readonly filePath: string
	write(message: string): void
	dispose(): Promise<void>
}

export interface RotatingFileLoggerOptions {
	logDir: string
	fileName: string
}

/** Resolve the persistent log directory shared by IDE, CLI, and ACP surfaces. */
export function resolveLogDirectory(dataDir?: string): string {
	if (process.env.DIRAC_LOG_DIR) return process.env.DIRAC_LOG_DIR
	if (process.env.DIRAC_DATA_DIR) return path.join(process.env.DIRAC_DATA_DIR, "logs")
	if (dataDir) return path.join(dataDir, "logs")

	const diracDir = process.env.DIRAC_DIR || path.join(os.homedir(), ".dirac")
	return path.join(diracDir, "data", "logs")
}

/**
 * Prepare all known persistent log families before any writer opens.
 * Legacy files are deliberately compacted to the newest retained 10 MiB.
 */
export function prepareLogDirectory(logDir: string): void {
	ensurePrivateDirectory(logDir)
	const markerPath = path.join(logDir, LOG_RETENTION_MARKER)
	if (fs.existsSync(markerPath)) {
		if (retentionFastPathComplies(logDir)) return

		for (const fileName of PERSISTENT_LOG_FILE_NAMES) {
			withLockSync(familyLockPath(logDir, fileName), () => migrateFamilyLocked(logDir, fileName, false))
		}

		withLockSync(path.join(logDir, LOG_MIGRATION_LOCK), () => {
			removeObsoleteLegacyLogs(logDir)
			if (!fs.existsSync(markerPath)) writePrivateFileAtomically(markerPath, `${LOG_RETENTION_VERSION}\n`)
		})
		return
	}

	withLockSync(path.join(logDir, LOG_MIGRATION_LOCK), () => {
		const forceMigration = !fs.existsSync(markerPath)

		for (const fileName of PERSISTENT_LOG_FILE_NAMES) {
			withLockSync(familyLockPath(logDir, fileName), () => migrateFamilyLocked(logDir, fileName, forceMigration))
		}

		removeObsoleteLegacyLogs(logDir)
		if (forceMigration) writePrivateFileAtomically(markerPath, `${LOG_RETENTION_VERSION}\n`)
	})
}

/** Lock-free steady-state check so parallel startups skip the global migration lock. */
function retentionFastPathComplies(logDir: string): boolean {
	try {
		for (const fileName of PERSISTENT_LOG_FILE_NAMES) {
			const files = listFamilyFiles(logDir, fileName)
			if (files.length > 0 && !familyAlreadyComplies(files)) return false
		}

		const obsoletePattern = /^dirac(?:\.\d+)?\.log$/
		for (const entry of fs.readdirSync(logDir)) {
			if (obsoletePattern.test(entry)) return false
		}
		return true
	} catch {
		return false
	}
}

export function createRotatingFileLogger(options: RotatingFileLoggerOptions): RotatingFileLogger {
	return new RotatingFileLoggerImpl(options)
}

/** Write a persistent entry synchronously, primarily for fatal crash reporting. */
export function writeLogEntrySync(options: RotatingFileLoggerOptions, message: string): void {
	assertLogFileName(options.fileName)
	prepareLogDirectory(options.logDir)
	const record = encodeBoundedRecord(message)
	withLockSync(familyLockPath(options.logDir, options.fileName), () => {
		migrateFamilyLocked(options.logDir, options.fileName, false)
		appendRecordsLocked(options.logDir, options.fileName, [record])
	})
}

class RotatingFileLoggerImpl implements RotatingFileLogger {
	readonly filePath: string

	private readonly logDir: string
	private readonly fileName: string
	private pendingRecords: Buffer[] = []
	private scheduledFlush: NodeJS.Immediate | undefined
	private flushChain: Promise<void> = Promise.resolve()
	private flushFailure: Error | undefined
	private disposed = false

	constructor(options: RotatingFileLoggerOptions) {
		assertLogFileName(options.fileName)
		this.logDir = options.logDir
		this.fileName = options.fileName
		this.filePath = path.join(options.logDir, options.fileName)
		prepareLogDirectory(options.logDir)
	}

	write = (message: string): void => {
		if (this.disposed) throw new Error(`Cannot write to disposed log file ${this.filePath}`)
		if (this.flushFailure) throw this.flushFailure

		this.pendingRecords.push(encodeBoundedRecord(message))
		if (this.scheduledFlush) return

		this.scheduledFlush = setImmediate(() => {
			this.scheduledFlush = undefined
			this.enqueuePendingRecords()
		})
	}

	async dispose(): Promise<void> {
		if (!this.disposed) {
			this.disposed = true
			if (this.scheduledFlush) {
				clearImmediate(this.scheduledFlush)
				this.scheduledFlush = undefined
			}
			this.enqueuePendingRecords()
		}

		await this.flushChain
		if (this.flushFailure) throw this.flushFailure
	}

	private enqueuePendingRecords(): void {
		if (this.pendingRecords.length === 0) return
		const records = this.pendingRecords
		this.pendingRecords = []

		this.flushChain = this.flushChain.then(() => {
			withLockSync(familyLockPath(this.logDir, this.fileName), () => {
				migrateFamilyLocked(this.logDir, this.fileName, false)
				appendRecordsLocked(this.logDir, this.fileName, records)
			})
		})
		this.flushChain = this.flushChain.catch((error: unknown) => {
			this.flushFailure = toError(error)
			process.stderr.write(`Failed to write ${this.filePath}: ${this.flushFailure.message}\n`)
		})
	}
}

function appendRecordsLocked(logDir: string, fileName: string, records: Buffer[]): void {
	const activePath = getFamilyPath(logDir, fileName, 0)
	let activeSize = fs.existsSync(activePath) ? fs.statSync(activePath).size : 0

	for (const record of records) {
		if (activeSize > 0 && activeSize + record.byteLength > LOG_MAX_FILE_SIZE_BYTES) {
			rotateFamilyLocked(logDir, fileName)
			activeSize = 0
		}

		fs.appendFileSync(activePath, record, { mode: 0o600 })
		setPrivateFileMode(activePath)
		activeSize += record.byteLength
	}
}

function rotateFamilyLocked(logDir: string, fileName: string): void {
	const oldestPath = getFamilyPath(logDir, fileName, LOG_MAX_FILES - 1)
	fs.rmSync(oldestPath, { force: true })

	for (let index = LOG_MAX_FILES - 2; index >= 1; index--) {
		const source = getFamilyPath(logDir, fileName, index)
		if (!fs.existsSync(source)) continue
		fs.renameSync(source, getFamilyPath(logDir, fileName, index + 1))
	}

	const activePath = getFamilyPath(logDir, fileName, 0)
	if (fs.existsSync(activePath)) fs.renameSync(activePath, getFamilyPath(logDir, fileName, 1))
}

function migrateFamilyLocked(logDir: string, fileName: string, forceMigration: boolean): void {
	const transactionDir = migrationTransactionPath(logDir, fileName)
	if (fs.existsSync(transactionDir)) {
		const manifestPath = path.join(transactionDir, "ready.json")
		if (fs.existsSync(manifestPath)) {
			installPreparedMigration(logDir, transactionDir)
			return
		}
		fs.rmSync(transactionDir, { recursive: true, force: true })
	}

	const files = listFamilyFiles(logDir, fileName)
	if (files.length === 0) return
	if (!forceMigration && familyAlreadyComplies(files)) {
		for (const file of files) setPrivateFileMode(file.path)
		return
	}

	const retainedContent = readNewestFamilyContent(files)
	const chunks = splitRetainedContent(retainedContent)
	prepareMigrationTransaction(transactionDir, fileName, chunks)
	installPreparedMigration(logDir, transactionDir)
}

function familyAlreadyComplies(files: FamilyFile[]): boolean {
	const cutoff = Date.now() - LOG_MAX_AGE_MS
	return (
		files.length <= LOG_MAX_FILES &&
		files.every((file) => file.archiveIndex < LOG_MAX_FILES && file.size <= LOG_MAX_FILE_SIZE_BYTES && file.mtimeMs >= cutoff)
	)
}

function readNewestFamilyContent(files: FamilyFile[]): Buffer {
	const cutoff = Date.now() - LOG_MAX_AGE_MS
	const retained: Buffer[] = []
	let remainingBytes = LOG_MAX_FILE_SIZE_BYTES * LOG_MAX_FILES

	for (let index = files.length - 1; index >= 0 && remainingBytes > 0; index--) {
		const file = files[index]
		if (file.mtimeMs < cutoff || file.size === 0) continue

		const readLength = Math.min(file.size, remainingBytes)
		const offset = file.size - readLength
		const buffer = readFileRange(file.path, offset, readLength)
		let retainedBuffer = buffer
		if (offset > 0) {
			const firstNewline = retainedBuffer.indexOf(0x0a)
			retainedBuffer = firstNewline === -1 ? Buffer.alloc(0) : retainedBuffer.subarray(firstNewline + 1)
		}

		if (retainedBuffer.byteLength > 0) {
			retained.unshift(retainedBuffer)
			remainingBytes -= retainedBuffer.byteLength
		}

		// Once a file was cut from the middle, every preceding file is older than omitted data.
		if (offset > 0) break
	}

	return Buffer.concat(retained)
}

function readFileRange(filePath: string, offset: number, length: number): Buffer {
	const descriptor = fs.openSync(filePath, "r")
	const buffer = Buffer.alloc(length)
	let bytesRead = 0
	try {
		while (bytesRead < length) {
			const count = fs.readSync(descriptor, buffer, bytesRead, length - bytesRead, offset + bytesRead)
			if (count === 0) throw new Error(`Unexpected end of log file ${filePath}`)
			bytesRead += count
		}
	} finally {
		fs.closeSync(descriptor)
	}
	return buffer
}

function splitRetainedContent(content: Buffer): Buffer[] {
	if (content.byteLength === 0) return []

	const chunks: Buffer[] = []
	let end = content.byteLength
	while (end > 0 && chunks.length < LOG_MAX_FILES) {
		let start = Math.max(0, end - LOG_MAX_FILE_SIZE_BYTES)
		if (start > 0) {
			const newline = content.indexOf(0x0a, start)
			const boundarySearchEnd = Math.min(end, start + 64 * 1024)
			start = newline >= start && newline < boundarySearchEnd ? newline + 1 : safeUtf8Start(content, start)
		}

		chunks.unshift(content.subarray(start, end))
		end = start
	}
	return chunks
}

function safeUtf8Start(content: Buffer, proposedStart: number): number {
	let start = proposedStart
	while (start < content.byteLength && (content[start] & 0xc0) === 0x80) start++
	return start
}

function prepareMigrationTransaction(transactionDir: string, fileName: string, chunks: Buffer[]): void {
	fs.mkdirSync(transactionDir, { recursive: true, mode: 0o700 })
	setPrivateDirectoryMode(transactionDir)

	const manifest: MigrationManifest = { fileName, chunks: [] }
	for (let index = 0; index < chunks.length; index++) {
		const source = `chunk-${index}`
		const archiveIndex = chunks.length - 1 - index
		const target = path.basename(getFamilyPath("", fileName, archiveIndex))
		const sourcePath = path.join(transactionDir, source)
		fs.writeFileSync(sourcePath, chunks[index], { mode: 0o600 })
		setPrivateFileMode(sourcePath)
		manifest.chunks.push({ source, target })
	}

	writePrivateFileAtomically(path.join(transactionDir, "ready.json"), JSON.stringify(manifest))
}

function installPreparedMigration(logDir: string, transactionDir: string): void {
	const manifest = JSON.parse(fs.readFileSync(path.join(transactionDir, "ready.json"), "utf8")) as MigrationManifest
	const preparedChunks = manifest.chunks.map((chunk) => {
		const targetPath = path.join(logDir, chunk.target)
		return {
			sourcePath: path.join(transactionDir, chunk.source),
			targetPath,
			temporaryPath: `${targetPath}.retention-v${LOG_RETENTION_VERSION}-install`,
		}
	})

	try {
		// Prepare every replacement beside its target before touching the installed family.
		for (const chunk of preparedChunks) {
			fs.rmSync(chunk.temporaryPath, { force: true })
			fs.copyFileSync(chunk.sourcePath, chunk.temporaryPath)
			setPrivateFileMode(chunk.temporaryPath)
		}

		for (const chunk of preparedChunks) {
			fs.rmSync(chunk.targetPath, { force: true })
			fs.renameSync(chunk.temporaryPath, chunk.targetPath)
		}

		const retainedPaths = new Set(preparedChunks.map((chunk) => chunk.targetPath))
		for (const file of listFamilyFiles(logDir, manifest.fileName)) {
			if (!retainedPaths.has(file.path)) fs.rmSync(file.path, { force: true })
		}

		fs.rmSync(transactionDir, { recursive: true, force: true })
	} finally {
		for (const chunk of preparedChunks) fs.rmSync(chunk.temporaryPath, { force: true })
	}
}

function listFamilyFiles(logDir: string, fileName: string): FamilyFile[] {
	const parsed = path.parse(fileName)
	const archivePattern = new RegExp(`^${escapeRegex(parsed.name)}\\.(\\d+)${escapeRegex(parsed.ext)}$`)
	const files: FamilyFile[] = []

	for (const entry of fs.readdirSync(logDir)) {
		let archiveIndex: number | undefined
		if (entry === fileName) archiveIndex = 0
		else {
			const match = archivePattern.exec(entry)
			if (match) archiveIndex = Number(match[1])
		}
		if (archiveIndex === undefined) continue

		const filePath = path.join(logDir, entry)
		const stats = fs.statSync(filePath)
		if (!stats.isFile()) continue
		files.push({ path: filePath, archiveIndex, mtimeMs: stats.mtimeMs, size: stats.size })
	}

	return files.sort((left, right) => right.archiveIndex - left.archiveIndex)
}

function removeObsoleteLegacyLogs(logDir: string): void {
	const obsoletePattern = /^dirac(?:\.\d+)?\.log$/
	for (const entry of fs.readdirSync(logDir)) {
		if (obsoletePattern.test(entry)) fs.rmSync(path.join(logDir, entry), { force: true })
	}
}

function encodeBoundedRecord(message: string): Buffer {
	const timestampPrefix = `${new Date().toISOString()} `
	const formattedMessage = prefixRecordLines(message, timestampPrefix)
	const record = formattedMessage.endsWith("\n") ? formattedMessage : `${formattedMessage}\n`
	const recordBuffer = Buffer.from(record, "utf8")
	if (recordBuffer.byteLength <= LOG_MAX_FILE_SIZE_BYTES) return recordBuffer

	const marker = Buffer.from(`${timestampPrefix}...[log record truncated from ${recordBuffer.byteLength} bytes]...\n`, "utf8")
	const headBudget = LOG_MAX_FILE_SIZE_BYTES - marker.byteLength - 1
	const head = recordBuffer.subarray(0, safeUtf8End(recordBuffer, headBudget))
	const separator = head.at(-1) === 0x0a ? Buffer.alloc(0) : Buffer.from("\n")
	return Buffer.concat([head, separator, marker])
}

function prefixRecordLines(message: string, timestampPrefix: string): string {
	const hasTrailingLineBreak = /(?:\r\n|\r|\n)$/.test(message)
	const lines = message.split(/\r\n|\r|\n/)
	if (hasTrailingLineBreak) lines.pop()

	const formattedLines = lines.map((line) => `${timestampPrefix}${line}`)
	return `${formattedLines.join("\n")}${hasTrailingLineBreak ? "\n" : ""}`
}

function safeUtf8End(content: Buffer, proposedEnd: number): number {
	let end = proposedEnd
	while (end > 0 && end < content.byteLength && (content[end] & 0xc0) === 0x80) end--
	return end
}

function getFamilyPath(logDir: string, fileName: string, archiveIndex: number): string {
	if (archiveIndex === 0) return path.join(logDir, fileName)
	const parsed = path.parse(fileName)
	return path.join(logDir, `${parsed.name}.${archiveIndex}${parsed.ext}`)
}

function migrationTransactionPath(logDir: string, fileName: string): string {
	return path.join(logDir, `.retention-v${LOG_RETENTION_VERSION}-${fileName}.migration`)
}

function familyLockPath(logDir: string, fileName: string): string {
	return path.join(logDir, `.${fileName}.lock`)
}

interface HeldLock {
	path: string
	token: string
}

function withLockSync<T>(lockPath: string, operation: () => T): T {
	const lock = acquireLockSync(lockPath)
	try {
		return operation()
	} finally {
		releaseLockSync(lock)
	}
}

function acquireLockSync(lockPath: string): HeldLock {
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
	const token = `${process.pid}-${randomUUID()}`
	while (true) {
		try {
			fs.mkdirSync(lockPath, { mode: 0o700 })
			try {
				writePrivateFileAtomically(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token }))
			} catch (error) {
				fs.rmSync(lockPath, { recursive: true, force: true })
				throw error
			}
			return { path: lockPath, token }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			removeStaleLock(lockPath)
			if (Date.now() >= deadline) throw new Error(describeLockTimeout(lockPath))
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS)
		}
	}
}

function releaseLockSync(lock: HeldLock): void {
	try {
		const owner = readLockOwner(lock.path)
		if (owner?.token === lock.token) fs.rmSync(lock.path, { recursive: true, force: true })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	}
}

function removeStaleLock(lockPath: string): void {
	let stats: fs.Stats
	try {
		stats = fs.statSync(lockPath)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}

	const owner = readLockOwner(lockPath)
	if (owner) {
		if (isProcessAlive(owner.pid)) return
		fs.rmSync(lockPath, { recursive: true, force: true })
		return
	}

	if (Date.now() - stats.mtimeMs < STALE_LOCK_AGE_MS) return
	fs.rmSync(lockPath, { recursive: true, force: true })
}

function describeLockTimeout(lockPath: string): string {
	try {
		const stats = fs.statSync(lockPath)
		const owner = readLockOwner(lockPath)
		const ageMs = Math.max(0, Date.now() - stats.mtimeMs)
		const holder = owner ? `pid=${owner.pid}` : "pid=unknown"
		return `Timed out waiting for log lock ${lockPath} (${holder}, age=${Math.round(ageMs)}ms). Another Dirac process may be compacting logs, or a crashed process left a live-holder lock. Set DIRAC_LOG_DIR to isolate parallel runs.`
	} catch {
		return `Timed out waiting for log lock ${lockPath}`
	}
}

function readLockOwner(lockPath: string): { pid: number; token: string } | undefined {
	try {
		return JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")) as {
			pid: number
			token: string
		}
	} catch {
		// A transient Windows EPERM (another process holding or deleting owner.json)
		// means ownership cannot be determined; report no owner so callers fall back
		// to age-based grace handling instead of crashing.
		return undefined
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

function ensurePrivateDirectory(directoryPath: string): void {
	fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
	setPrivateDirectoryMode(directoryPath)
}

function setPrivateDirectoryMode(directoryPath: string): void {
	if (process.platform !== "win32") fs.chmodSync(directoryPath, 0o700)
}

function setPrivateFileMode(filePath: string): void {
	if (process.platform !== "win32") fs.chmodSync(filePath, 0o600)
}

function writePrivateFileAtomically(filePath: string, content: string): void {
	const temporaryPath = `${filePath}.${process.pid}.tmp`
	fs.writeFileSync(temporaryPath, content, { mode: 0o600 })
	setPrivateFileMode(temporaryPath)
	fs.renameSync(temporaryPath, filePath)
}

function assertLogFileName(fileName: string): void {
	if (path.basename(fileName) !== fileName || path.extname(fileName) !== ".log") {
		throw new Error(`Invalid persistent log file name: ${fileName}`)
	}
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

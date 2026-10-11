import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import * as diff from "diff"
import { isValidAnchorId } from "../shared/utils/line-hashing"
import { MAX_ANCHORED_FILE_LINES } from "../shared/anchor-limits"

interface TrackedDocument {
	hashes: Uint32Array
	anchors: string[]
	usedWords: Set<string>
	availablePool: string[]
}

export interface PersistedAnchorDocument {
	absolutePath: string
	hashes: number[]
	anchors: string[]
	usedWords: string[]
	availablePool: string[]
}

export interface PersistedAnchorState {
	version: 1
	documents: PersistedAnchorDocument[]
}

export class AnchorStateManager {
	private static storage = new Map<string, Map<string, TrackedDocument>>()
	private static dictionary: string[] = []
	public static readonly MAX_TRACKED_FILES = 1024
	private static readonly MAX_TRACKED_TASKS = 50

	private static computeHashes(lines: string[]): Uint32Array {
		const hashes = new Uint32Array(lines.length)
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			let h = 2166136261
			for (let j = 0; j < line.length; j++) {
				h = Math.imul(h ^ line.charCodeAt(j), 16777619)
			}
			hashes[i] = h >>> 0
		}
		return hashes
	}

	private static getDictionary(): string[] {
		if (AnchorStateManager.dictionary.length === 0) {
			const dictionaryPath = path.join(__dirname, ".hash_anchors")
			// Do not catch errors here; anchor allocation must fail loudly.
			AnchorStateManager.dictionary = fs.readFileSync(dictionaryPath, "utf8").split(/\r?\n/).filter(Boolean)
		}
		return AnchorStateManager.dictionary
	}

	private static refill(usedWords: Set<string>, pool: string[]): void {
		const dictionary = AnchorStateManager.getDictionary()
		const newWords: string[] = []
		const newWordSet = new Set<string>()
		const addWord = (word: string): boolean => {
			if (usedWords.has(word) || newWordSet.has(word)) return false
			newWords.push(word)
			newWordSet.add(word)
			return newWords.length === 10000
		}

		for (const first of dictionary) {
			for (const second of dictionary) {
				if (addWord(`${first}${second}`)) {
					pool.push(...newWords)
					return
				}
			}
		}

		for (const first of dictionary) {
			for (const second of dictionary) {
				for (const third of dictionary) {
					if (addWord(`${first}${second}${third}`)) {
						pool.push(...newWords)
						return
					}
				}
			}
		}

		pool.push(...newWords)
	}

	private static getUniqueWord(usedWords: Set<string>, pool: string[]): string {
		while (true) {
			if (pool.length === 0) AnchorStateManager.refill(usedWords, pool)

			const word = pool.pop()!
			if (!usedWords.has(word)) return word
		}
	}

	private static storeTaskState(taskId: string, state: Map<string, TrackedDocument>): void {
		AnchorStateManager.storage.delete(taskId)
		AnchorStateManager.storage.set(taskId, state)
		if (AnchorStateManager.storage.size <= AnchorStateManager.MAX_TRACKED_TASKS) return

		const oldestTaskId = AnchorStateManager.storage.keys().next().value
		if (oldestTaskId !== undefined) AnchorStateManager.storage.delete(oldestTaskId)
	}

	private static getTaskState(taskId = "default"): Map<string, TrackedDocument> {
		const state = AnchorStateManager.storage.get(taskId) ?? new Map<string, TrackedDocument>()
		AnchorStateManager.storeTaskState(taskId, state)
		return state
	}

	/**
	 * Reconciles current file content with saved state using Myers diff.
	 * Unchanged lines keep their visible IDs; new lines receive unused IDs.
	 */
	public static reconcile(absolutePath: string, currentLines: string[], taskId?: string): string[] {
		return AnchorStateManager.reconcileWithChanges(absolutePath, currentLines, taskId).anchors
	}

	/** Reconciles anchors and reports whether the persisted task state changed. */
	public static reconcileWithChanges(
		absolutePath: string,
		currentLines: string[],
		taskId?: string,
	): { anchors: string[]; changed: boolean } {
		if (currentLines.length > MAX_ANCHORED_FILE_LINES) {
			throw new Error(
				`Cannot create hash anchors for ${currentLines.length.toLocaleString()} lines; the limit is ${MAX_ANCHORED_FILE_LINES.toLocaleString()} lines.`,
			)
		}
		const state = AnchorStateManager.getTaskState(taskId)
		const currentHashes = AnchorStateManager.computeHashes(currentLines)
		let tracked = state.get(absolutePath)
		const wasMostRecentDocument = Array.from(state.keys()).at(-1) === absolutePath

		if (tracked && tracked.hashes.length === currentHashes.length) {
			let identical = true
			for (let i = 0; i < currentHashes.length; i++) {
				if (tracked.hashes[i] !== currentHashes[i]) {
					identical = false
					break
				}
			}
			if (identical) {
				AnchorStateManager.updateState(absolutePath, tracked, taskId)
				return { anchors: tracked.anchors, changed: !wasMostRecentDocument }
			}
		}

		if (!tracked) {
			const usedWords = new Set<string>()
			const pool = [...AnchorStateManager.getDictionary()]
			for (let i = pool.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1))
					;[pool[i], pool[j]] = [pool[j], pool[i]]
			}

			const anchors = currentLines.map(() => {
				const word = AnchorStateManager.getUniqueWord(usedWords, pool)
				usedWords.add(word)
				return word
			})

			tracked = { hashes: currentHashes, anchors, usedWords, availablePool: pool }
			AnchorStateManager.updateState(absolutePath, tracked, taskId)
			return { anchors, changed: true }
		}

		const changes = diff.diffArrays(Array.from(tracked.hashes), Array.from(currentHashes))
		const newAnchors: string[] = []
		const newUsedWords = new Set<string>(tracked.usedWords)
		const pool = tracked.availablePool

		// Older persisted documents may not have retained their remaining pool.
		if (pool.length === 0 && newUsedWords.size < AnchorStateManager.getDictionary().length) {
			for (const word of AnchorStateManager.getDictionary()) {
				if (!newUsedWords.has(word)) pool.push(word)
			}
		}

		let oldIndex = 0
		for (const change of changes) {
			if (change.added) {
				for (let i = 0; i < change.count!; i++) {
					const word = AnchorStateManager.getUniqueWord(newUsedWords, pool)
					newAnchors.push(word)
					newUsedWords.add(word)
				}
				continue
			}
			if (change.removed) {
				oldIndex += change.count!
				continue
			}
			for (let i = 0; i < change.count!; i++) {
				const preservedWord = tracked.anchors[oldIndex]
				newAnchors.push(preservedWord)
				newUsedWords.add(preservedWord)
				oldIndex++
			}
		}

		tracked = { hashes: currentHashes, anchors: newAnchors, usedWords: newUsedWords, availablePool: pool }
		AnchorStateManager.updateState(absolutePath, tracked, taskId)
		return { anchors: newAnchors, changed: true }
	}

	private static updateState(absolutePath: string, document: TrackedDocument, taskId?: string): void {
		const state = AnchorStateManager.getTaskState(taskId)
		state.delete(absolutePath)
		state.set(absolutePath, document)
		if (state.size <= AnchorStateManager.MAX_TRACKED_FILES) return

		const oldestPath = state.keys().next().value
		if (oldestPath !== undefined) state.delete(oldestPath)
	}

	private static fingerprint(document: TrackedDocument): string {
		const revision = document.anchors.map((anchor, index) => [document.hashes[index], anchor])
		return createHash("sha256").update(JSON.stringify(revision)).digest("hex")
	}

	/** Returns an exact revision for the current content-fingerprint-to-visible-ID mapping. */
	public static getDocumentFingerprint(absolutePath: string, taskId?: string): string | null {
		const document = AnchorStateManager.getTaskState(taskId).get(absolutePath)
		return document ? AnchorStateManager.fingerprint(document) : null
	}

	/** Serializes the complete conversation-scoped state needed for exact restoration. */
	public static exportState(taskId = "default"): PersistedAnchorState {
		const documents = Array.from(AnchorStateManager.getTaskState(taskId), ([absolutePath, document]) => ({
			absolutePath,
			hashes: Array.from(document.hashes),
			anchors: [...document.anchors],
			usedWords: Array.from(document.usedWords),
			availablePool: [...document.availablePool],
		}))
		return { version: 1, documents }
	}

	/** Serializes one tracked file without visiting unrelated anchor documents. */
	public static exportDocument(absolutePath: string, taskId = "default"): PersistedAnchorDocument | undefined {
		const document = AnchorStateManager.getTaskState(taskId).get(absolutePath)
		if (!document) return undefined
		return {
			absolutePath,
			hashes: Array.from(document.hashes),
			anchors: [...document.anchors],
			usedWords: Array.from(document.usedWords),
			availablePool: [...document.availablePool],
		}
	}

	private static validatePersistedDocument(document: PersistedAnchorDocument, seenPaths: Set<string>): void {
		if (!document || typeof document.absolutePath !== "string" || !path.isAbsolute(document.absolutePath)) {
			throw new Error("Persisted anchor document must have an absolutePath.")
		}
		if (seenPaths.has(document.absolutePath)) {
			throw new Error(`Persisted anchor state contains duplicate document path: ${document.absolutePath}`)
		}
		seenPaths.add(document.absolutePath)

		if (!Array.isArray(document.hashes) || !Array.isArray(document.anchors) || document.hashes.length !== document.anchors.length) {
			throw new Error(`Persisted anchor state has mismatched hashes and anchors for ${document.absolutePath}.`)
		}
		if (document.hashes.some((hash) => !Number.isInteger(hash) || hash < 0 || hash > 0xffffffff)) {
			throw new Error(`Persisted anchor state contains an invalid content fingerprint for ${document.absolutePath}.`)
		}

		const anchors = new Set(document.anchors)
		if (anchors.size !== document.anchors.length || document.anchors.some((anchor) => !isValidAnchorId(anchor))) {
			throw new Error(`Persisted anchor state contains duplicate or invalid visible IDs for ${document.absolutePath}.`)
		}
		if (!Array.isArray(document.usedWords) || document.usedWords.some((anchor) => !isValidAnchorId(anchor))) {
			throw new Error(`Persisted anchor state contains invalid used IDs for ${document.absolutePath}.`)
		}
		const usedWords = new Set(document.usedWords)
		if (usedWords.size !== document.usedWords.length || document.anchors.some((anchor) => !usedWords.has(anchor))) {
			throw new Error(`Persisted anchor state has inconsistent used IDs for ${document.absolutePath}.`)
		}
		if (!Array.isArray(document.availablePool) || document.availablePool.some((anchor) => !isValidAnchorId(anchor))) {
			throw new Error(`Persisted anchor state contains invalid available IDs for ${document.absolutePath}.`)
		}
		const availablePool = new Set(document.availablePool)
		if (availablePool.size !== document.availablePool.length || document.availablePool.some((anchor) => usedWords.has(anchor))) {
			throw new Error(`Persisted anchor state has an inconsistent available ID pool for ${document.absolutePath}.`)
		}
	}

	/** Replaces in-memory state with the exact persisted conversation snapshot. */
	public static hydrate(taskId: string, persisted: PersistedAnchorState | undefined): void {
		AnchorStateManager.storage.delete(taskId)
		if (!persisted) return
		if (persisted.version !== 1) {
			throw new Error(`Unsupported persisted anchor state version: ${String((persisted as any).version)}`)
		}
		if (!Array.isArray(persisted.documents)) {
			throw new Error("Persisted anchor state must contain a documents array.")
		}
		if (persisted.documents.length > AnchorStateManager.MAX_TRACKED_FILES) {
			throw new Error(`Persisted anchor state exceeds the ${AnchorStateManager.MAX_TRACKED_FILES}-document task limit.`)
		}

		const state = new Map<string, TrackedDocument>()
		const seenPaths = new Set<string>()
		for (const document of persisted.documents) {
			AnchorStateManager.validatePersistedDocument(document, seenPaths)
			state.set(document.absolutePath, {
				hashes: Uint32Array.from(document.hashes),
				anchors: [...document.anchors],
				usedWords: new Set(document.usedWords),
				availablePool: [...document.availablePool],
			})
		}
		AnchorStateManager.storeTaskState(taskId, state)
	}

	/** Returns true if the file is currently being tracked. */
	public static isTracking(absolutePath: string, taskId?: string): boolean {
		return AnchorStateManager.getTaskState(taskId).has(absolutePath)
	}

	/** Gets current anchors for a file if it is being tracked. */
	public static getAnchors(absolutePath: string, taskId?: string): string[] | null {
		return AnchorStateManager.getTaskState(taskId).get(absolutePath)?.anchors || null
	}

	/** Clears state for one file. */
	public static clearState(absolutePath: string, taskId?: string): void {
		AnchorStateManager.getTaskState(taskId).delete(absolutePath)
	}

	/** Resets anchor state for one task or for all tasks. */
	public static reset(taskId?: string): void {
		if (taskId) {
			AnchorStateManager.storage.delete(taskId)
			return
		}
		AnchorStateManager.storage.clear()
	}
}

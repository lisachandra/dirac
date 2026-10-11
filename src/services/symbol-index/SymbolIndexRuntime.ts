import { type FSWatcher, watch } from "node:fs"
import * as path from "node:path"
import { Logger } from "../../shared/services/Logger"
import { SymbolIndexTelemetry } from "./SymbolIndexTelemetry"

export type SymbolIndexWatcherEventKind = "change" | "rename" | "remove"

export interface SymbolIndexWatcherEvent {
	absolutePath: string
	kind: SymbolIndexWatcherEventKind
}

export interface SymbolIndexRuntimeDependencies {
	admitsPath(absolutePath: string): boolean
	excludesPath(absolutePath: string): boolean
	isControlPath(absolutePath: string): boolean
	applyWatcherEvents(events: readonly SymbolIndexWatcherEvent[]): Promise<void>
	requestReconciliation(reason: string): Promise<void>
}

export type SymbolIndexWatchFactory = (
	watchPath: string,
	options: { persistent: boolean; recursive: boolean },
	listener: (eventType: "rename" | "change", filename: string | Buffer | null) => void,
) => FSWatcher

interface ExternalControlWatcher {
	watcher: FSWatcher
	controlPaths: Set<string>
}

const defaultWatchFactory: SymbolIndexWatchFactory = (watchPath, options, listener) =>
	watch(watchPath, { ...options, encoding: "utf8" }, listener)

export class SymbolIndexRuntime {
	private static readonly EVENT_BATCH_DELAY_MS = 1_000
	private static readonly MAX_PENDING_EVENTS = 500
	private static readonly RECONCILIATION_INTERVAL_MS = 5 * 60_000
	private static readonly EXTERNAL_CONTROL_RETRY_BASE_DELAY_MS = 1_000
	private static readonly EXTERNAL_CONTROL_RETRY_MAX_DELAY_MS = 5 * 60_000
	private static readonly EXTERNAL_CONTROL_RETRY_STABILITY_MS = 30_000

	private workspaceWatcher: FSWatcher | null = null
	private readonly externalControlWatchers = new Map<string, ExternalControlWatcher>()
	private readonly desiredExternalControlPaths = new Map<string, Set<string>>()
	private readonly externalControlRetryTimers = new Map<string, NodeJS.Timeout>()
	private readonly externalControlRetryResetTimers = new Map<string, NodeJS.Timeout>()
	private readonly externalControlRetryAttempts = new Map<string, number>()
	private readonly pendingEvents = new Map<string, SymbolIndexWatcherEventKind>()
	private eventTimer: NodeJS.Timeout | null = null
	private activeFlush: Promise<void> | null = null
	private reconciliationTimer: NodeJS.Timeout | null = null
	private liveWatchingDisabled = false
	private disposed = false

	public constructor(
		private readonly projectRoot: string,
		private readonly dependencies: SymbolIndexRuntimeDependencies,
		private readonly watchFactory: SymbolIndexWatchFactory = defaultWatchFactory,
	) {
		this.startWorkspaceWatcher()
		this.schedulePeriodicReconciliation()
	}

	public refreshExternalControlPaths(controlPaths: ReadonlySet<string>): void {
		if (this.disposed || this.liveWatchingDisabled) return

		const desiredByDirectory = new Map<string, Set<string>>()
		for (const controlPath of controlPaths) {
			const normalizedPath = path.normalize(controlPath)
			const directory = path.dirname(normalizedPath)
			const paths = desiredByDirectory.get(directory) ?? new Set<string>()
			paths.add(normalizedPath)
			desiredByDirectory.set(directory, paths)
		}
		for (const directory of this.desiredExternalControlPaths.keys()) {
			if (!desiredByDirectory.has(directory)) this.clearExternalControlRetry(directory)
		}
		this.desiredExternalControlPaths.clear()
		for (const [directory, desiredPaths] of desiredByDirectory) {
			this.desiredExternalControlPaths.set(directory, desiredPaths)
		}

		for (const [directory, ownedWatcher] of this.externalControlWatchers) {
			const desiredPaths = desiredByDirectory.get(directory)
			if (desiredPaths) {
				ownedWatcher.controlPaths = desiredPaths
				continue
			}
			ownedWatcher.watcher.close()
			this.externalControlWatchers.delete(directory)
		}

		for (const [directory, desiredPaths] of desiredByDirectory) {
			if (this.externalControlWatchers.has(directory) || this.externalControlRetryTimers.has(directory)) continue
			this.startExternalControlWatcher(directory, desiredPaths)
		}
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		if (this.eventTimer) clearTimeout(this.eventTimer)
		if (this.reconciliationTimer) clearTimeout(this.reconciliationTimer)
		this.eventTimer = null
		this.reconciliationTimer = null
		this.pendingEvents.clear()
		this.closeAllWatchers()
		await this.activeFlush
	}

	private startWorkspaceWatcher(): void {
		try {
			const watcher = this.watchFactory(this.projectRoot, { persistent: true, recursive: true }, (eventType, filename) =>
				this.recordWorkspaceChange(eventType, filename),
			)
			this.workspaceWatcher = watcher
			watcher.on("error", (error) => this.disableLiveWatching(watcher, error))
		} catch (error) {
			this.disableLiveWatching(null, error)
		}
	}

	private startExternalControlWatcher(directory: string, controlPaths: Set<string>): void {
		try {
			const watcher = this.watchFactory(directory, { persistent: true, recursive: false }, (_eventType, filename) => {
				this.recordExternalControlChange(directory, filename)
			})
			this.externalControlWatchers.set(directory, { watcher, controlPaths })
			watcher.on("error", (error) => this.disableExternalControlWatcher(directory, watcher, error))
			this.scheduleExternalControlRetryReset(directory, watcher)
		} catch (error) {
			this.scheduleExternalControlWatcherRetry(directory)
			Logger.warn(`[SymbolIndexRuntime] External eligibility-control watching disabled for ${directory}`, error)
			this.requestFullReconciliation(`external control watcher unavailable: ${directory}`)
		}
	}

	private recordWorkspaceChange(eventType: "rename" | "change", filename: string | Buffer | null): void {
		if (this.disposed || this.liveWatchingDisabled) return
		if (filename === null) {
			this.requestFullReconciliation("workspace watcher reported an ambiguous path")
			return
		}

		const absolutePath = path.resolve(this.projectRoot, filename.toString())
		if (!this.isInsideProjectRoot(absolutePath)) {
			SymbolIndexTelemetry.recordWatcherRejected()
			return
		}

		SymbolIndexTelemetry.recordWatcherEvent()
		if (this.dependencies.isControlPath(absolutePath)) {
			this.requestFullReconciliation(`eligibility control changed: ${absolutePath}`)
			return
		}
		if (this.dependencies.excludesPath(absolutePath)) {
			SymbolIndexTelemetry.recordWatcherRejected()
			return
		}
		if (eventType === "change" && !this.dependencies.admitsPath(absolutePath)) {
			SymbolIndexTelemetry.recordWatcherRejected()
			return
		}
		this.queueFileEvent(absolutePath, eventType)
	}

	private recordExternalControlChange(directory: string, filename: string | Buffer | null): void {
		if (this.disposed || this.liveWatchingDisabled) return
		const ownedWatcher = this.externalControlWatchers.get(directory)
		if (!ownedWatcher) return
		if (filename === null) {
			this.requestFullReconciliation(`external eligibility control changed under ${directory}`)
			return
		}

		const absolutePath = path.resolve(directory, filename.toString())
		if (ownedWatcher.controlPaths.has(absolutePath)) {
			this.requestFullReconciliation(`external eligibility control changed: ${absolutePath}`)
		}
	}

	private queueFileEvent(absolutePath: string, kind: SymbolIndexWatcherEventKind): void {
		if (this.disposed) return
		if (!this.pendingEvents.has(absolutePath) && this.pendingEvents.size >= SymbolIndexRuntime.MAX_PENDING_EVENTS) {
			this.pendingEvents.clear()
			if (this.eventTimer) clearTimeout(this.eventTimer)
			this.eventTimer = null
			this.requestFullReconciliation("watcher event overflow")
			return
		}

		const existingKind = this.pendingEvents.get(absolutePath)
		this.pendingEvents.set(absolutePath, this.coalesceEventKind(existingKind, kind))
		SymbolIndexTelemetry.recordDirtySetSize(this.pendingEvents.size)
		if (this.eventTimer) clearTimeout(this.eventTimer)
		this.eventTimer = setTimeout(() => void this.flushEvents(), SymbolIndexRuntime.EVENT_BATCH_DELAY_MS)
	}

	private coalesceEventKind(
		existingKind: SymbolIndexWatcherEventKind | undefined,
		incomingKind: SymbolIndexWatcherEventKind,
	): SymbolIndexWatcherEventKind {
		if (incomingKind === "remove" || existingKind === "remove") return "remove"
		if (incomingKind === "rename" || existingKind === "rename") return "rename"
		return "change"
	}

	private flushEvents(): Promise<void> {
		if (this.activeFlush) return this.activeFlush
		this.activeFlush = this.drainEventBatches().finally(() => {
			this.activeFlush = null
		})
		return this.activeFlush
	}

	private async drainEventBatches(): Promise<void> {
		this.eventTimer = null
		while (!this.disposed && this.pendingEvents.size > 0) {
			const events = [...this.pendingEvents].map(([absolutePath, kind]) => ({ absolutePath, kind }))
			this.pendingEvents.clear()
			try {
				await this.dependencies.applyWatcherEvents(events)
			} catch (error) {
				SymbolIndexTelemetry.recordFailure()
				Logger.error("[SymbolIndexRuntime] Watcher batch failed; requesting reconciliation", error)
				await this.requestReconciliationSafely("watcher batch failure")
			}
		}
		if (this.eventTimer) clearTimeout(this.eventTimer)
		this.eventTimer = null
	}

	private disableLiveWatching(watcher: FSWatcher | null, error: unknown): void {
		if (this.disposed || this.liveWatchingDisabled) return
		if (watcher && this.workspaceWatcher !== watcher) return
		this.liveWatchingDisabled = true
		this.pendingEvents.clear()
		if (this.eventTimer) clearTimeout(this.eventTimer)
		this.eventTimer = null
		this.closeAllWatchers()

		const code = (error as NodeJS.ErrnoException).code
		const capacityFailure = code === "EMFILE" || code === "ENFILE" || code === "ENOSPC"
		const reason = capacityFailure
			? `watcher capacity exhausted (${code})`
			: `workspace watcher failed (${code ?? "unknown"})`
		Logger.warn(
			`[SymbolIndexRuntime] Live symbol-index watching disabled; periodic reconciliation remains active: ${reason}`,
			error,
		)
		this.requestFullReconciliation(reason)
	}

	private disableExternalControlWatcher(directory: string, watcher: FSWatcher, error: unknown): void {
		const ownedWatcher = this.externalControlWatchers.get(directory)
		if (!ownedWatcher || ownedWatcher.watcher !== watcher) return

		const code = (error as NodeJS.ErrnoException).code
		if (code === "EMFILE" || code === "ENFILE" || code === "ENOSPC") {
			this.disableLiveWatching(this.workspaceWatcher, error)
			return
		}

		this.externalControlWatchers.delete(directory)
		this.clearExternalControlRetryReset(directory)
		this.scheduleExternalControlWatcherRetry(directory)
		watcher.close()
		Logger.warn(`[SymbolIndexRuntime] External eligibility-control watching disabled for ${directory}`, error)
		this.requestFullReconciliation(`external control watcher failed: ${directory}`)
	}
	private scheduleExternalControlRetryReset(directory: string, watcher: FSWatcher): void {
		if (!this.externalControlRetryAttempts.has(directory)) return

		const timer = setTimeout(() => {
			this.externalControlRetryResetTimers.delete(directory)
			if (this.externalControlWatchers.get(directory)?.watcher === watcher) {
				this.externalControlRetryAttempts.delete(directory)
			}
		}, SymbolIndexRuntime.EXTERNAL_CONTROL_RETRY_STABILITY_MS)
		timer.unref()
		this.externalControlRetryResetTimers.set(directory, timer)
	}

	private clearExternalControlRetryReset(directory: string): void {
		const timer = this.externalControlRetryResetTimers.get(directory)
		if (timer) clearTimeout(timer)
		this.externalControlRetryResetTimers.delete(directory)
	}

	private scheduleExternalControlWatcherRetry(directory: string): void {
		if (this.disposed || this.liveWatchingDisabled || this.externalControlRetryTimers.has(directory)) return
		if (!this.desiredExternalControlPaths.has(directory)) return

		const attempt = (this.externalControlRetryAttempts.get(directory) ?? 0) + 1
		this.externalControlRetryAttempts.set(directory, attempt)
		const delay = Math.min(
			SymbolIndexRuntime.EXTERNAL_CONTROL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
			SymbolIndexRuntime.EXTERNAL_CONTROL_RETRY_MAX_DELAY_MS,
		)
		const timer = setTimeout(() => {
			this.externalControlRetryTimers.delete(directory)
			if (this.disposed || this.liveWatchingDisabled || this.externalControlWatchers.has(directory)) return
			const controlPaths = this.desiredExternalControlPaths.get(directory)
			if (controlPaths) this.startExternalControlWatcher(directory, controlPaths)
		}, delay)
		timer.unref()
		this.externalControlRetryTimers.set(directory, timer)
	}

	private clearExternalControlRetry(directory: string): void {
		this.clearExternalControlRetryReset(directory)
		const timer = this.externalControlRetryTimers.get(directory)
		if (timer) clearTimeout(timer)
		this.externalControlRetryTimers.delete(directory)
		this.externalControlRetryAttempts.delete(directory)
	}

	private clearAllExternalControlRetries(): void {
		for (const timer of this.externalControlRetryResetTimers.values()) clearTimeout(timer)
		this.externalControlRetryResetTimers.clear()
		for (const timer of this.externalControlRetryTimers.values()) clearTimeout(timer)
		this.externalControlRetryTimers.clear()
		this.externalControlRetryAttempts.clear()
	}

	private closeAllWatchers(): void {
		const workspaceWatcher = this.workspaceWatcher
		this.workspaceWatcher = null
		workspaceWatcher?.close()
		for (const { watcher } of this.externalControlWatchers.values()) watcher.close()
		this.externalControlWatchers.clear()
		this.clearAllExternalControlRetries()
	}

	private isInsideProjectRoot(absolutePath: string): boolean {
		const relativePath = path.normalize(path.relative(this.projectRoot, absolutePath))
		return (
			relativePath === "." ||
			(relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
		)
	}

	private requestFullReconciliation(reason: string): void {
		if (this.disposed) return
		void this.requestReconciliationSafely(reason)
	}

	private async requestReconciliationSafely(reason: string): Promise<void> {
		try {
			await this.dependencies.requestReconciliation(reason)
		} catch (error) {
			SymbolIndexTelemetry.recordFailure()
			Logger.error(`[SymbolIndexRuntime] Reconciliation request failed (${reason})`, error)
		}
	}

	private schedulePeriodicReconciliation(): void {
		const jitter = 0.9 + Math.random() * 0.2
		this.reconciliationTimer = setTimeout(async () => {
			this.reconciliationTimer = null
			if (this.disposed) return
			try {
				await this.requestReconciliationSafely("periodic repair")
			} finally {
				if (!this.disposed) this.schedulePeriodicReconciliation()
			}
		}, SymbolIndexRuntime.RECONCILIATION_INTERVAL_MS * jitter)
		this.reconciliationTimer.unref()
	}
}

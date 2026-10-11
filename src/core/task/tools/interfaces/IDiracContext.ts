export interface IDiracContext {
	task: {
		get<T>(key: string): Promise<T | undefined>
		getEntry<T>(key: string, entryKey: string): Promise<T | undefined>
		getEntries<T>(key: string, entryKeys: readonly string[]): Promise<Record<string, T>>
		set<T>(key: string, value: T): Promise<void>
		update<T>(key: string, updater: (value: T | undefined) => T): Promise<void>
		updateEntries<T>(key: string, updates: Record<string, T>, deletions?: readonly string[]): Promise<void>
	}
	workspace: {
		get<T>(key: string): T | undefined
		set<T>(key: string, value: T): void
	}
	global: {
		get<T>(key: string): T | undefined
		set<T>(key: string, value: T): void
	}
	resetTaskContext(): Promise<void>
	load(): Promise<void>
	ensureAnchorState(): Promise<void>
	markAnchorStateDirty(absolutePath?: string): void
	save(): Promise<void>
}

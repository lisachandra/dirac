import type { ApiConfiguration } from "@shared/api"
import { ApiHandlerSettingsKeys, isSettingsKey, type LocalState, type Settings } from "@shared/storage/state-keys"
import { normalizeLoadedSetting } from "@core/storage/StateManagerSettings"

/** Recursively exposes configuration values through read-only contracts. */
export type DeepReadonly<T> = T extends (...args: any[]) => any
	? T
	: T extends Date
	? Readonly<Date>
	: T extends Map<infer K, infer V>
	? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
	: T extends Set<infer U>
	? ReadonlySet<DeepReadonly<U>>
	: T extends readonly (infer U)[]
	? readonly DeepReadonly<U>[]
	: T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T

/** Global-state values that affect execution but are not part of Settings. */
export interface TaskExecutionOptions {
	terminalReuseEnabled: boolean
	vscodeTerminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	multiRootEnabled: boolean
}

/** Workspace-scoped configuration consumed by task runtime code. */
export type TaskWorkspaceConfiguration = LocalState

/**
 * One detached, immutable effective configuration owned by a Task.
 *
 * apiConfiguration can contain credentials. It must remain private to the Task
 * runtime and must never be serialized into transcripts or exposed to tools.
 */
export interface TaskWorkingConfiguration {
	readonly revision: number
	readonly settings: DeepReadonly<Settings>
	readonly apiConfiguration: DeepReadonly<ApiConfiguration>
	readonly workspaceConfiguration: DeepReadonly<TaskWorkspaceConfiguration>
	readonly executionOptions: DeepReadonly<TaskExecutionOptions>
}

export interface TaskWorkingConfigurationInput {
	revision?: number
	settings: Settings
	apiConfiguration: ApiConfiguration
	workspaceConfiguration: TaskWorkspaceConfiguration
	executionOptions: TaskExecutionOptions
}

/**
 * Explicit fields that a running Task can replace. Execution options are
 * construction-only because they own terminal and workspace resources.
 */
export interface TaskWorkingConfigurationPatch {
	settings?: Partial<Settings>
	apiConfiguration?: Partial<ApiConfiguration>
	workspaceConfiguration?: Partial<TaskWorkspaceConfiguration>
}

/** Clone a supported structured value without losing owned undefined fields. */
export function cloneConfigurationValue<T>(value: T): T {
	return structuredClone(value)
}

/** Deep-freeze a detached configuration value before exposing it to consumers. */
export function deepFreezeConfiguration<T>(value: T): DeepReadonly<T> {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value as DeepReadonly<T>
	}

	if (value instanceof Map) {
		for (const [key, entryValue] of value) {
			deepFreezeConfiguration(key)
			deepFreezeConfiguration(entryValue)
		}
	} else if (value instanceof Set) {
		for (const entryValue of value) deepFreezeConfiguration(entryValue)
	} else {
		for (const key of Reflect.ownKeys(value)) {
			deepFreezeConfiguration((value as Record<PropertyKey, unknown>)[key])
		}
	}

	return Object.freeze(value) as DeepReadonly<T>
}

/** Construct a detached and deeply frozen task working configuration. */
export function createTaskWorkingConfiguration(input: TaskWorkingConfigurationInput): TaskWorkingConfiguration {
	if (!Number.isSafeInteger(input.revision ?? 1) || (input.revision ?? 1) < 1) {
		throw new Error("Task working configuration revision must be a positive safe integer")
	}

	return deepFreezeConfiguration(
		cloneConfigurationValue({
			revision: input.revision ?? 1,
			settings: input.settings,
			apiConfiguration: input.apiConfiguration,
			workspaceConfiguration: input.workspaceConfiguration,
			executionOptions: input.executionOptions,
		}),
	)
}

/**
 * Build the next immutable revision from only the current task configuration
 * and an explicit patch. This deliberately does not consult StateManager.
 * Validation and API-handler construction remain the Task transaction's job.
 */
export function buildTaskWorkingConfigurationUpdate(
	current: TaskWorkingConfiguration,
	patch: TaskWorkingConfigurationPatch,
): TaskWorkingConfiguration {
	const settings = { ...current.settings, ...patch.settings } as Settings
	const apiConfiguration = { ...current.apiConfiguration, ...patch.apiConfiguration } as ApiConfiguration

	if (patch.settings) {
		for (const [key, value] of Object.entries(patch.settings)) {
			; (settings as Record<string, unknown>)[key] = normalizeLoadedSetting(key as keyof Settings, value as never)
		}
	}
	if (patch.apiConfiguration) {
		for (const [key, value] of Object.entries(patch.apiConfiguration)) {
			if (isSettingsKey(key)) {
				; (apiConfiguration as Record<string, unknown>)[key] = normalizeLoadedSetting(key, value as never)
			}
		}
	}

	for (const key of ApiHandlerSettingsKeys) {
		if (patch.settings && Object.hasOwn(patch.settings, key)) {
			; (apiConfiguration as Record<string, unknown>)[key] = settings[key]
		} else if (patch.apiConfiguration && Object.hasOwn(patch.apiConfiguration, key)) {
			; (settings as Record<string, unknown>)[key] = apiConfiguration[key]
		}
	}

	return createTaskWorkingConfiguration({
		revision: current.revision + 1,
		settings,
		apiConfiguration,
		workspaceConfiguration: {
			...current.workspaceConfiguration,
			...patch.workspaceConfiguration,
		} as TaskWorkspaceConfiguration,
		executionOptions: current.executionOptions as TaskExecutionOptions,
	})
}

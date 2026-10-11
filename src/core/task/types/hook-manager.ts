import { ApiHandler } from "../../../core/api"
import type { TaskWorkingConfiguration } from "../runtime/TaskWorkingConfiguration"
import type { TaskRequestRuntime } from "../runtime/TaskRequestRuntime"
import { MessageStateHandler } from "../message-state"
import { TaskMessenger } from "../TaskMessenger"
import { TaskState } from "../TaskState"

export interface HookManagerDependencies {
	taskState: TaskState
	messageStateHandler: MessageStateHandler
	getWorkingConfiguration: () => TaskWorkingConfiguration
	getRequestRuntime?: () => TaskRequestRuntime | undefined
	api?: ApiHandler
	shouldRunBackgroundCheck: () => boolean
	taskId: string
	ulid?: string
	taskMessenger: TaskMessenger
	postStateToWebview: () => Promise<void>
	cancelTask: () => Promise<void>
	withStateLock: <T>(fn: () => T | Promise<T>) => Promise<T>
}

export type UserPromptHookResult = {
	cancel?: boolean
	wasCancelled?: boolean
	contextModification?: string
	errorMessage?: string
}

import { ApiHandler, ApiProviderInfo } from "../../../core/api"
import type { TaskWorkingConfiguration } from "../runtime/TaskWorkingConfiguration"
import type { TaskRequestRuntime } from "../runtime/TaskRequestRuntime"
import { MessageStateHandler } from "../message-state"
import { TaskState } from "../TaskState"

export interface TaskMessengerDependencies {
	taskState: TaskState
	messageStateHandler: MessageStateHandler
	postStateToWebview: () => Promise<void>
	postPresentationToWebview?: () => Promise<void>
	getWorkingConfiguration: () => TaskWorkingConfiguration
	getRequestRuntime?: () => TaskRequestRuntime | undefined
	taskId: string
	api?: ApiHandler
	getCurrentProviderInfo: () => ApiProviderInfo
}

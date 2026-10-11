import { ApiProviderInfo } from "../../../core/api"
import { WorkspaceRootManager } from "../../../core/workspace/WorkspaceRootManager"
import { UrlContentFetcher } from "../../../services/browser/UrlContentFetcher"
import { FileContextTracker } from "../../context/context-tracking/FileContextTracker"
import { DiracIgnoreController } from "../../ignore/DiracIgnoreController"
import { CommandPermissionController } from "../../permissions/CommandPermissionController"
import type { TaskRequestRuntime } from "../runtime/TaskRequestRuntime"
import type { StateManager } from "../../storage/StateManager"
import { TaskState } from "../TaskState"

import type { TextCondensationTemplateId } from "@core/text-condensation/TextCondenser"
export interface ContextLoaderDependencies {
	ulid: string
	stateManager: StateManager
	getRequestRuntime: () => TaskRequestRuntime
	cwd: string
	urlContentFetcher: UrlContentFetcher
	fileContextTracker: FileContextTracker
	workspaceManager?: WorkspaceRootManager
	diracIgnoreController: DiracIgnoreController
	commandPermissionController: CommandPermissionController
	taskState: TaskState
	extensionPath: string
	sourceDir: string

	getCurrentProviderInfo: () => ApiProviderInfo
	getEnvironmentDetails: (includeFileDetails?: boolean) => Promise<string>
	isTextCondensationAvailable?: (template: TextCondensationTemplateId) => boolean

	postStateToWebview: () => Promise<void>
}

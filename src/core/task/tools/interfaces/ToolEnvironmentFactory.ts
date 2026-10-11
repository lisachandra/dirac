import type { ICardHandle, IToolEnvironment } from "./IToolEnvironment"
import type { TaskConfig } from "../types/TaskConfig"

export interface ToolExecutionEnvironment extends IToolEnvironment {
	getCustomMetadata(): Record<string, unknown>
	getCreatedCards(): ICardHandle[]
}

export interface ToolEnvironmentFactory {
	create(config: TaskConfig, toolName: string): ToolExecutionEnvironment
}

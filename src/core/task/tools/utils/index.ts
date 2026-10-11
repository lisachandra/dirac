import { TaskConfig } from "../types/TaskConfig"

export * from "../types/TaskConfig"
export * from "./ToolConstants"
export { ToolDisplayUtils } from "./ToolDisplayUtils"

export function getTaskCompletionTelemetry(config: TaskConfig) {
	const currentMode = config.mode
	const provider = config.providerId
	const model = config.model
	const durationMs = Math.max(0, Date.now() - config.taskState.taskStartTimeMs)

	return {
		provider,
		modelId: model.id,
		apiFormat: model.info.apiFormat,
		timeToFirstTokenMs: config.taskState.taskFirstTokenTimeMs,
		durationMs,
		mode: currentMode,
	}
}

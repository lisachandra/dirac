import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { telemetryService } from "../../../services/telemetry"
import { Controller } from ".."

/** Apply webview telemetry-gated toggle settings: yolo, webTools, subagents, autoCondense */
export function applyTelemetrySettingsWebview(controller: Controller, request: UpdateSettingsRequest): void {
	if (request.yoloModeToggled !== undefined) {
		if (controller.task) telemetryService.captureYoloModeToggle(controller.task.ulid, request.yoloModeToggled)
		controller.stateManager.setGlobalState("yoloModeToggled", request.yoloModeToggled)
	}
	if (request.diracWebToolsEnabled !== undefined) {
		if (controller.task) telemetryService.captureDiracWebToolsToggle(controller.task.ulid, request.diracWebToolsEnabled)
		controller.stateManager.setGlobalState("diracWebToolsEnabled", request.diracWebToolsEnabled)
	}
	if (request.subagentsEnabled !== undefined) {
		const wasEnabled = controller.stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
		const isEnabled = !!request.subagentsEnabled
		controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)
		if (wasEnabled !== isEnabled) telemetryService.captureSubagentToggle(isEnabled)
	}
	if (request.useAutoCondense !== undefined) {
		if (controller.task)
			telemetryService.captureAutoCondenseToggle(
				controller.task.ulid,
				request.useAutoCondense,
				controller.task.api.getModel().id,
			)
		controller.stateManager.setGlobalState("useAutoCondense", request.useAutoCondense)
	}
}

/** Publish CLI telemetry for settings already persisted and committed to the active Task. */
export function applyTelemetrySettingsCli(controller: Controller, fields: any): void {
	if (fields.yoloModeToggled !== undefined && controller.task) {
		telemetryService.captureYoloModeToggle(controller.task.ulid, fields.yoloModeToggled)
	}
	if (fields.useAutoCondense !== undefined && controller.task) {
		telemetryService.captureAutoCondenseToggle(
			controller.task.ulid,
			fields.useAutoCondense,
			controller.task.api.getModel().id,
		)
	}
	if (fields.diracWebToolsEnabled !== undefined && controller.task) {
		telemetryService.captureDiracWebToolsToggle(controller.task.ulid, fields.diracWebToolsEnabled)
	}
	if (fields.subagentsEnabled !== undefined) {
		telemetryService.captureSubagentToggle(!!fields.subagentsEnabled)
	}
}

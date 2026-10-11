import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Controller } from ".."
import { applyApiConfigurationTransaction, commitWorkingConfigurationUpdate } from "../models/apiConfigurationTransaction"
import { persistApiConfigurationAndMode } from "../models/apiConfigurationPersistence"
import { convertMode } from "./settingsMode"

/** Apply one webview API/mode update through a single persistence and active-Task commit boundary. */
export async function applyApiConfiguration(controller: Controller, request: UpdateSettingsRequest): Promise<void> {
	const mode = convertMode(request.mode)
	if (!request.apiConfiguration) {
		if (mode === undefined) return
		await commitWorkingConfigurationUpdate(
			controller,
			() => persistApiConfigurationAndMode(controller.stateManager, {}, mode),
			controller.task ? { settings: { mode } } : undefined,
		)
		return
	}

	const configuration = convertProtoToApiConfiguration(request.apiConfiguration)
	await applyApiConfigurationTransaction(
		controller,
		configuration,
		() => persistApiConfigurationAndMode(controller.stateManager, configuration, mode),
		mode,
	)
}

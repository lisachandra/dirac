import { Empty } from "@shared/proto/dirac/common"
import { UpdateApiConfigurationRequest } from "@shared/proto/dirac/models"
import { convertProtoToApiConfiguration } from "@shared/proto-conversions/models/api-configuration-conversion"
import { recordSavedOpenAiCompatibleProfileChanges } from "@/core/models/modelProviderPresets"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { applyApiConfigurationTransaction } from "./apiConfigurationTransaction"

/**
 * Updates API configuration
 * @param controller The controller instance
 * @param request The update API configuration request
 * @returns Empty response
 */
export async function updateApiConfigurationProto(
	controller: Controller,
	request: UpdateApiConfigurationRequest,
): Promise<Empty> {
	try {
		if (!request.apiConfiguration) {
			Logger.log("[APICONFIG: updateApiConfigurationProto] API configuration is required")
			throw new Error("API configuration is required")
		}

		const protoApiConfiguration = request.apiConfiguration

		const convertedApiConfigurationFromProto = convertProtoToApiConfiguration(protoApiConfiguration)

		const previousProfiles = controller.stateManager.getApiConfiguration().openAiCompatibleProfiles || []

		await applyApiConfigurationTransaction(controller, convertedApiConfigurationFromProto)
		recordSavedOpenAiCompatibleProfileChanges(controller.stateManager, previousProfiles)

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		Logger.error(`Failed to update API configuration: ${error}`)
		throw error
	}
}

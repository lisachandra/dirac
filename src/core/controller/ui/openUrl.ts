import type { StringRequest } from "@shared/proto/dirac/common"
import { Empty } from "@shared/proto/dirac/common"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import type { Controller } from "../index"

/**
 * Opens a URL in the default browser
 * @param controller The controller instance
 * @param request The URL to open
 * @returns Empty response
 */
export async function openUrl(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		// Opening a verification page must not overwrite a device code the user just copied.
		await openExternal(request.value)
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open URL: ${error}`)
		throw error
	}
}

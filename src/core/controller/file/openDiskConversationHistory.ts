import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { getSavedApiConversationHistory, writeConversationHistoryJson } from "@core/storage/disk"
import { Empty, StringRequest } from "@shared/proto/dirac/common"
import { Controller } from ".."
/**
 * Opens a file in the editor
 * @param controller The controller instance
 * @param request The request message containing the file path in the 'value' field
 * @returns Empty response
 */
export async function openDiskConversationHistory(_controller: Controller, request: StringRequest): Promise<Empty> {
	if (request.value) {
		const history = await getSavedApiConversationHistory(request.value)
		openFileIntegration(await writeConversationHistoryJson(request.value, history))
	}
	return Empty.create()
}

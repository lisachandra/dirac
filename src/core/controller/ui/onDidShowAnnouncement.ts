import type { EmptyRequest } from "@shared/proto/dirac/common"
import { Boolean } from "@shared/proto/dirac/common"
import { Logger } from "@/shared/services/Logger"
import { getLatestAnnouncementId } from "@/utils/announcements"
import type { Controller } from "../index"

/**
 * Marks the current announcement as shown
 *
 * @param controller The controller instance
 * @param _request The empty request (not used)
 * @returns Boolean indicating announcement should no longer be shown
 */
export async function onDidShowAnnouncement(controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	try {
		const latestAnnouncementId = getLatestAnnouncementId()
		controller.stateManager.setGlobalStateBatch({
			lastShownAnnouncementId: latestAnnouncementId,
			pendingReleaseNotesFromVersion: undefined,
		})
		await controller.stateManager.flushPendingState()
		return Boolean.create({ value: false })
	} catch (error) {
		Logger.error("Failed to acknowledge announcement:", error)
		return Boolean.create({ value: false })
	}
}

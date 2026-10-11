import { useCallback, useRef } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient } from "@/shared/api/grpc-client"

export function useAutoApproveAll() {
	const {
		autoApproveAllToggled,
		beginAutoApproveAllUpdate,
		finishAutoApproveAllUpdate,
		pendingAutoApproveAllToggled,
	} = useSettingsStore()
	const mutationInProgress = useRef(false)

	const updateAutoApproveAll = useCallback(
		async (checked: boolean) => {
			if (mutationInProgress.current || pendingAutoApproveAllToggled !== undefined) return

			mutationInProgress.current = true
			const previous = autoApproveAllToggled
			beginAutoApproveAllUpdate(checked)
			try {
				await StateServiceClient.updateSettings({ metadata: {}, autoApproveAllToggled: checked })
				finishAutoApproveAllUpdate(checked)
			} catch (error) {
				finishAutoApproveAllUpdate(
					previous,
					error instanceof Error ? error.message : "Failed to update Approve All",
				)
			} finally {
				mutationInProgress.current = false
			}
		},
		[
			autoApproveAllToggled,
			beginAutoApproveAllUpdate,
			finishAutoApproveAllUpdate,
			pendingAutoApproveAllToggled,
		],
	)

	return { updateAutoApproveAll }
}

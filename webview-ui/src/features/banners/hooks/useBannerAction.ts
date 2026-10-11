import type { ApiProvider } from "@shared/api"
import { type BannerAction, BannerActionType } from "@shared/dirac/banner"
import { useCallback } from "react"
import { useAppStore } from "@/app/store/appStore"
import { useApiConfigurationHandlers } from "@/features/settings/components/utils/useApiConfigurationHandlers"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { StateServiceClient, UiServiceClient } from "@/shared/api/grpc-client"

export function useBannerAction(): (action: BannerAction) => void {
	const openRouterModels = useSettingsStore((state) => state.openRouterModels)
	const navigateToAccount = useAppStore((state) => state.navigateToAccount)
	const navigateToSettings = useAppStore((state) => state.navigateToSettings)
	const navigateToSettingsModelPicker = useAppStore((state) => state.navigateToSettingsModelPicker)
	const { handleFieldsChange } = useApiConfigurationHandlers()

	return useCallback(
		(action: BannerAction) => {
			switch (action.action ?? BannerActionType.Link) {
				case BannerActionType.Link:
					if (action.arg) UiServiceClient.openUrl({ value: action.arg }).catch(console.error)
					return

				case BannerActionType.SetModel: {
					if (!action.arg) return
					const modelId = action.arg
					handleFieldsChange({
						planModeOpenRouterModelId: modelId,
						actModeOpenRouterModelId: modelId,
						planModeOpenRouterModelInfo: openRouterModels[modelId],
						actModeOpenRouterModelInfo: openRouterModels[modelId],
						planModeApiProvider: "openrouter",
						actModeApiProvider: "openrouter",
					})
					navigateToSettingsModelPicker({ targetSection: "api-config" })
					return
				}

				case BannerActionType.ShowAccount:
					navigateToAccount()
					return

				case BannerActionType.ShowApiSettings:
					if (action.arg) {
						const provider = action.arg as ApiProvider
						handleFieldsChange({ planModeApiProvider: provider, actModeApiProvider: provider })
					}
					navigateToSettings("models-api")
					return

				case BannerActionType.ShowFeatureSettings:
					navigateToSettings("running-tasks")
					return

				case BannerActionType.InstallCli:
					StateServiceClient.installDiracCli({}).catch((error) =>
						console.error("Failed to initiate CLI installation:", error),
					)
					return

				default:
					console.warn("Unknown banner action:", action.action)
			}
		},
		[handleFieldsChange, navigateToAccount, navigateToSettings, navigateToSettingsModelPicker, openRouterModels],
	)
}

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { getAsVar, VSC_TITLEBAR_INACTIVE_FOREGROUND } from "@/shared/lib/vscStyles"
import AutoApproveModal from "./AutoApproveModal"

interface AutoApproveBarProps {
	style?: React.CSSProperties
}

export type AutonomySummary =
	| "YOLO Mode"
	| "Approve All"
	| "Selected auto-approval"
	| "AI-assisted approval"
	| "Ask every time"

export function getAutonomySummary(
	yoloModeToggled: boolean,
	autoApproveAllToggled: boolean,
	actions: Record<string, boolean | undefined>,
	utilityApprovalEnabled: boolean,
): AutonomySummary {
	if (yoloModeToggled) return "YOLO Mode"
	if (autoApproveAllToggled) return "Approve All"
	if (Object.values(actions).some(Boolean)) return "Selected auto-approval"
	if (utilityApprovalEnabled) return "AI-assisted approval"
	return "Ask every time"
}

const AutoApproveBar = ({ style }: AutoApproveBarProps) => {
	const {
		autoApprovalSettings,
		yoloModeToggled,
		autoApproveAllToggled,
		remoteConfigSettings,
		utilityModelPermissionPolicy,
		utilityModelSelection,
		utilityModelUsePermissionHandling,
	} = useSettingsStore()
	const [isModalVisible, setIsModalVisible] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const effectiveYoloMode = remoteConfigSettings?.yoloModeToggled ?? yoloModeToggled
	const utilityApprovalEnabled =
		utilityModelUsePermissionHandling && Boolean(utilityModelSelection?.modelId) && utilityModelPermissionPolicy.trim() !== ""
	const summary = getAutonomySummary(
		effectiveYoloMode,
		autoApproveAllToggled,
		autoApprovalSettings.actions,
		utilityApprovalEnabled,
	)
	const borderColor = `color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`
	return (
		<div
			className="modular-auto-approve mx-4 select-none break-words relative"
			style={{
				borderTop: `0.5px solid ${borderColor}`,
				borderRadius: "4px 4px 0 0",
				...style,
			}}>
			<button
				aria-expanded={isModalVisible}
				aria-label={`${summary}. ${isModalVisible ? "Close" : "Open"} autonomy summary`}
				className="group w-full cursor-pointer border-0 bg-transparent pt-3 pb-3.5 px-3.5 text-left text-inherit flex items-center justify-between gap-2"
				onClick={() => setIsModalVisible((visible) => !visible)}
				ref={buttonRef}
				type="button">
				<div className="flex min-w-0 items-center gap-1">
					<span className="whitespace-nowrap">Autonomy:</span>
					<span className="truncate text-muted-foreground group-hover:text-foreground">{summary}</span>
				</div>
				{isModalVisible ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
			</button>
			<AutoApproveModal
				buttonRef={buttonRef}
				isVisible={isModalVisible}
				setIsVisible={setIsModalVisible}
			/>
		</div>
	)
}

export default AutoApproveBar

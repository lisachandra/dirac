import type { ApiProvider } from "@shared/api"
import {
	DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT,
	getAutoCondenseContextLimit,
	isValidAutoCondenseContextLimit,
} from "@shared/context-management"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useSettingsStore } from "../store/settingsStore"
import { updateSetting } from "./utils/settingsHandlers"

interface AutoCondenseContextLimitSettingProps {
	providerId: ApiProvider
}

export const AutoCondenseContextLimitSetting = ({ providerId }: AutoCondenseContextLimitSettingProps) => {
	const { autoCondenseContextLimits, useAutoCondense } = useSettingsStore()
	const savedLimit = getAutoCondenseContextLimit(autoCondenseContextLimits, providerId)
	const [value, setValue] = useState(String(savedLimit))

	const save = () => {
		const parsed = Number(value.replaceAll(",", ""))
		const limit = isValidAutoCondenseContextLimit(parsed) ? parsed : savedLimit
		setValue(String(limit))
		if (limit === savedLimit) return
		updateSetting("autoCondenseContextLimits", { limits: { ...autoCondenseContextLimits, [providerId]: limit } })
	}

	return (
		<div style={{ marginBottom: 15, marginTop: 15 }}>
			<label
				htmlFor={`auto-condense-context-limit-${providerId}`}
				style={{ display: "block", fontWeight: 500, marginBottom: 5 }}>
				Condense threshold
			</label>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<VSCodeTextField
					disabled={!useAutoCondense}
					id={`auto-condense-context-limit-${providerId}`}
					onBlur={save}
					onInput={(event: any) => setValue(event.target.value)}
					onKeyDown={(event: any) => {
						if (event.key === "Enter") event.currentTarget.blur()
					}}
					placeholder={String(DEFAULT_AUTO_CONDENSE_CONTEXT_LIMIT)}
					value={value}
				/>
				<span className="text-xs text-description">tokens</span>
			</div>
			<p className="text-xs text-description" style={{ margin: "5px 0 0" }}>
				{useAutoCondense
					? "Conversation history is condensed at this provider-specific limit. Models with smaller context windows may condense sooner."
					: "Enable Auto-condense conversations above to use this provider-specific limit."}
			</p>
		</div>
	)
}

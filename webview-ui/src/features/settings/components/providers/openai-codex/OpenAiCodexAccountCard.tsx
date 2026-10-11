import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { formatOpenAiCodexPlan } from "./formatOpenAiCodexUsage"
import { OpenAiCodexSignIn } from "./OpenAiCodexSignIn"

interface OpenAiCodexAccountCardProps {
	isAuthenticated: boolean
	email?: string
	planType?: string
	authError?: string
	onSignOut: () => void
}

export function OpenAiCodexAccountCard({
	isAuthenticated,
	email,
	planType,
	authError,
	onSignOut,
}: OpenAiCodexAccountCardProps) {
	const planLabel = formatOpenAiCodexPlan(planType)

	if (!isAuthenticated) {
		return (
			<section className="openai-codex-account rounded-md border border-(--vscode-panel-border) p-3">
				<h3 className="m-0 text-sm font-medium text-(--vscode-foreground)">ChatGPT subscription</h3>
				<p className="mb-3 mt-1 text-xs leading-5 text-(--vscode-descriptionForeground)">
					Use your ChatGPT subscription to run Codex models. No API key is required.
				</p>
				<OpenAiCodexSignIn />
				{authError && (
					<p className="mb-0 mt-2 text-xs leading-4 text-(--vscode-descriptionForeground)" role="status">
						{authError}
					</p>
				)}
			</section>
		)
	}

	return (
		<section className="openai-codex-account rounded-md border border-(--vscode-panel-border) p-3">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="m-0 text-sm font-medium text-(--vscode-foreground)">ChatGPT subscription</h3>
						{planLabel && <Badge variant="outline">{planLabel}</Badge>}
						<span className="text-[11px] text-(--vscode-descriptionForeground)">Connected</span>
					</div>
					<p className="mb-0 mt-1 break-all text-xs text-(--vscode-descriptionForeground)">
						{email || "ChatGPT user"}
					</p>
				</div>
				<Button className="shrink-0 text-(--vscode-descriptionForeground)" onClick={onSignOut} size="xs" type="button" variant="ghost">
					Sign out
				</Button>
			</div>
			{authError && (
				<p className="mb-0 mt-2 text-xs leading-4 text-(--vscode-descriptionForeground)" role="status">
					{authError}
				</p>
			)}
		</section>
	)
}

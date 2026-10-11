import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { memo, useId } from "react"
import { MarkdownRow } from "./MarkdownRow"

const LONG_MESSAGE_LINE_THRESHOLD = 12
const LONG_MESSAGE_CHARACTER_THRESHOLD = 1_200
const LONG_MESSAGE_CHARACTER_THRESHOLD_MIN_LINES = 4
const COLLAPSED_PREVIEW_LINE_COUNT = 5
const COLLAPSED_PREVIEW_CHARACTER_LIMIT = 800

function splitLines(content: string): string[] {
	return content.replace(/\r\n?/g, "\n").split("\n")
}

export function isLongUserMessage(content: string): boolean {
	const lineCount = splitLines(content).length
	return (
		lineCount >= LONG_MESSAGE_LINE_THRESHOLD ||
		(lineCount >= LONG_MESSAGE_CHARACTER_THRESHOLD_MIN_LINES && content.length >= LONG_MESSAGE_CHARACTER_THRESHOLD)
	)
}

function createCollapsedPreview(content: string): string {
	return splitLines(content).slice(0, COLLAPSED_PREVIEW_LINE_COUNT).join("\n").slice(0, COLLAPSED_PREVIEW_CHARACTER_LIMIT)
}

interface UserMessageContentProps {
	content: string
	isExpanded: boolean
	onToggleExpand: () => void
}

export const UserMessageContent = memo(({ content, isExpanded, onToggleExpand }: UserMessageContentProps) => {
	const contentId = useId()
	const lineCount = splitLines(content).length

	if (!isLongUserMessage(content)) {
		return (
			<div className="whitespace-pre-wrap">
				<MarkdownRow markdown={content} showCursor={false} />
			</div>
		)
	}

	const action = isExpanded ? "Collapse" : "Expand"

	return (
		<div className="overflow-hidden rounded-md border border-foreground/10 bg-foreground/[0.025]">
			<button
				aria-controls={contentId}
				aria-expanded={isExpanded}
				aria-label={`${action} long message (${lineCount} lines)`}
				className="flex w-full cursor-pointer items-center gap-1.5 border-0 border-b border-foreground/10 bg-transparent px-2.5 py-1.5 text-left text-xs text-(--vscode-descriptionForeground) hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
				onClick={onToggleExpand}
				type="button">
				<span aria-hidden="true" className="shrink-0 opacity-70">
					{isExpanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
				</span>
				<span className="font-medium text-foreground/90">Long message</span>
				<span className="opacity-70">· {lineCount} lines</span>
			</button>

			{isExpanded ? (
				<div
					className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap px-2.5 py-2 custom-scrollbar"
					id={contentId}>
					<MarkdownRow markdown={content} showCursor={false} />
				</div>
			) : (
				<div className="relative max-h-28 overflow-hidden px-2.5 py-2" id={contentId}>
					<pre className="m-0 whitespace-pre-wrap wrap-anywhere font-inherit text-sm leading-relaxed text-foreground/80">
						{createCollapsedPreview(content)}
					</pre>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-(--vscode-editor-background)/70"
					/>
				</div>
			)}
		</div>
	)
})

UserMessageContent.displayName = "UserMessageContent"

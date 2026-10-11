import { SteeringTranscriptStatus } from "@shared/ExtensionMessage"
import { MarkdownRow } from "./components/MarkdownRow"
import { ThinkingRow } from "./components/ThinkingRow"
import { UserMessageContent } from "./components/UserMessageContent"
import { WithCopyButton } from "@/shared/ui/CopyButton"
import { cn } from "@/lib/utils"
import Thumbnails from "@/shared/ui/Thumbnails"
import QuoteButton from "./components/QuoteButton"
import { useQuoteLogic } from "./hooks/useQuoteLogic"
import { memo } from "react"

const NOOP = () => { }

interface ModularMarkdownProps {
	content: string
	isReasoning?: boolean
	images?: string[]
	files?: string[]
	partial?: boolean
	streamingMessageId?: string
	isExpanded?: boolean
	onToggleExpand?: () => void
	onAskForUpdate?: () => void
	onSetQuote?: (text: string) => void
	role?: "user" | "assistant"
	steeringStatus?: SteeringTranscriptStatus
}

export const ModularMarkdown = memo(
	({
		content,
		isReasoning,
		images,
		files,
		partial,
		streamingMessageId,
		isExpanded,
		onToggleExpand,
		onAskForUpdate,
		onSetQuote,
		role,
		steeringStatus,
	}: ModularMarkdownProps) => {
		const { quoteButtonState, handleQuoteClick, handleMouseUp, contentRef } = useQuoteLogic(onSetQuote || NOOP)

		if (isReasoning) {
			return (
				<ThinkingRow
					isExpanded={isExpanded || false}
					isStreaming={partial}
					isVisible={true}
					onToggle={onToggleExpand || NOOP}
					reasoningContent={content}
					showChevron={true}
					showTitle={true}
					streamingMessageId={streamingMessageId}
					onAskForUpdate={onAskForUpdate}
					title={partial ? "Thinking..." : "Thinking"}
				/>
			)
		}

		return (
			<WithCopyButton
				className={cn(partial === true && "opacity-70")}
				position="bottom-right"
				textToCopy={partial === true ? undefined : content}>
				<div
					className={cn("flex items-center", role === "user" && "justify-end")}
					onMouseUp={handleMouseUp}
					ref={contentRef}>
					<div className="flex min-w-0 flex-1 flex-col">
						<div
							className={cn(
								"modular-message relative min-w-0 flex-1 rounded-lg border px-3 py-2 text-base leading-relaxed",
								role === "user"
									? "modular-message-user border-(--vscode-focusBorder)/25 bg-(--vscode-focusBorder)/10"
									: "modular-message-assistant border-foreground/10 bg-foreground/[0.025]",
							)}>
							{role === "user" ? (
								<UserMessageContent
									content={content}
									isExpanded={isExpanded ?? false}
									onToggleExpand={onToggleExpand ?? NOOP}
								/>
							) : (
								<MarkdownRow markdown={content} showCursor={false} />
							)}
							{quoteButtonState.visible && (
								<QuoteButton left={quoteButtonState.left} onClick={handleQuoteClick} top={quoteButtonState.top} />
							)}
						</div>
						{steeringStatus && (
							<div className="mt-1 text-right text-xs text-(--vscode-descriptionForeground)">
								{steeringStatus === SteeringTranscriptStatus.QUEUED
									? "Queued for next turn"
									: "Sent with next turn"}
							</div>
						)}
					</div>
				</div>
				{((images && images.length > 0) || (files && files.length > 0)) && (
					<Thumbnails files={files ?? []} images={images ?? []} className="mt-2" />
				)}
			</WithCopyButton>
		)
	},
)

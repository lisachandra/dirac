import { type DiracMessage, type UIActionButton, UIActionButtonType } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useState } from "react"
import { isNewTaskCard } from "../../utils/newTaskCard"
import { useChatStore } from "@/features/chat/store/chatStore"
import type { ChatState, MessageHandlers } from "../types/chatTypes"
import { ButtonActionType } from "../utils/buttonConfig"

interface ActionButtonsProps {
	task?: DiracMessage
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		scrollToTop: () => void
		showScrollToBottom: boolean
	}
}

const ActionButtons: React.FC<ActionButtonsProps> = ({ task, chatState, messageHandlers, scrollBehavior }) => {
	const {
		inputValue,
		selectedImages,
		selectedFiles,
		setSendingDisabled,
		uiActionState,
		activeVoiceStreamId,
		isApiRequestActive,
	} = chatState
	const [isProcessing, setIsProcessing] = useState(false)

	const { lastMessage, secondLastMessage } = chatState
	const activeCard = useChatStore((state) => {
		const activeCardId = state.uiActionState?.activeCardId
		const activeCardIndex = activeCardId ? state.messageIndexById.get(activeCardId) : undefined
		const message = activeCardIndex === undefined ? undefined : state.diracMessages[activeCardIndex]
		return message?.content.type === "card" ? message.content.card : undefined
	})

	// Single effect to handle all configuration updates
	useEffect(() => {
		if (uiActionState) {
			setSendingDisabled(uiActionState.sendingDisabled)
		}
	}, [uiActionState, setSendingDisabled])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (
			lastMessage?.content.type === "api_status" &&
			secondLastMessage?.content.type === "card" &&
			secondLastMessage.content.card.icon === "terminal"
		) {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage, secondLastMessage, chatState])

	const handleActionClick = useCallback(
		async (action: ButtonActionType, value?: string, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) {
				return
			}
			setIsProcessing(true)

			try {
				await messageHandlers.executeButtonAction(action, value, text, images, files, uiActionState?.activeCardId)
			} catch (error) {
				console.error(`[ActionButtons] Failed to execute action ${action}:`, error)
			} finally {
				setIsProcessing(false)
			}
		},
		[messageHandlers, isProcessing, uiActionState?.activeCardId],
	)

	// Keyboard event handler
	const globalButtons = uiActionState?.globalButtons || []
	const promotedCardButtons = activeCard && isNewTaskCard(activeCard) ? (uiActionState?.cardButtons ?? []) : []
	const hasActiveButtons = globalButtons.length > 0

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape" && hasActiveButtons) {
				event.preventDefault()
				event.stopPropagation()
				handleActionClick("cancel")
			}
		},
		[handleActionClick, hasActiveButtons],
	)

	useEffect(() => {
		if (!hasActiveButtons) return
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown, hasActiveButtons])

	if (!task) {
		return null
	}

	const { showScrollToBottom, scrollToBottomSmooth, scrollToTop } = scrollBehavior

	const allButtons = [...promotedCardButtons, ...globalButtons]
	const hasButtons = allButtons.length > 0
	const isStreaming = isApiRequestActive || !!activeVoiceStreamId
	const canInteract = !isStreaming && !isProcessing

	// Early return for scroll button to avoid unnecessary computation
	if (!hasButtons) {
		return (
			<div className="flex px-3">
				<VSCodeButton
					appearance="icon"
					aria-label={showScrollToBottom ? "Scroll to bottom" : "Scroll to top"}
					className="text-lg text-(--vscode-primaryButton-foreground) bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_55%,transparent)] rounded-[3px] overflow-hidden cursor-pointer flex justify-center items-center flex-1 h-[25px] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_90%,transparent)] active:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_70%,transparent)] border-0"
					onClick={showScrollToBottom ? scrollToBottomSmooth : scrollToTop}>
					{showScrollToBottom ? (
						<span className="codicon codicon-chevron-down" />
					) : (
						<span className="codicon codicon-chevron-up" />
					)}
				</VSCodeButton>
			</div>
		)
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex px-3 gap-2" style={{ opacity }}>
			{allButtons.map((button: UIActionButton) => (
				<VSCodeButton
					appearance={button.primary ? "primary" : "secondary"}
					className="flex-1"
					disabled={!canInteract && button.action !== UIActionButtonType.CANCEL}
					key={`${button.action}:${button.value ?? ""}:${button.label}`}
					onClick={() => handleActionClick(button.action, button.value, inputValue, selectedImages, selectedFiles)}>
					{button.label}
				</VSCodeButton>
			))}
		</div>
	)
}

export default ActionButtons

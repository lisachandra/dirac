import { DiracMessage, DiracMessageType, isFinalStatus, type TaskStatus } from "@shared/ExtensionMessage"
import { useChatTimeline } from "./useChatTimeline"
import { calculateChatLayoutRows } from "../utils/chat-layout"

export function useChatMessages(
	messages: DiracMessage[],
	activeVoiceStreamId?: string,
	isApiRequestActive?: boolean,
	taskStatus?: TaskStatus,
) {
	const timeline = useChatTimeline({
		messages,
		activeVoiceStreamId,
		isApiRequestActive,
		taskStatus,
		showHeader: false,
		layoutRows: calculateChatLayoutRows({
			terminalRows: 24,
			hasConversationContent: true,
			hasComposer: true,
			hasFooter: true,
			hasPanel: false,
		}),
		terminalColumns: process.stdout.columns || 80,
		shouldSuppressCardBody: (message) =>
			message.content.type === DiracMessageType.CARD &&
			!isFinalStatus(message.content.card.status) &&
			Boolean(message.content.card.requireApproval || message.content.card.requireFeedback),
	})

	return {
		displayMessages: timeline.displayMessages,
		committedMessages: timeline.staticItems.filter((item) => item.type === "message").map((item) => item.message),
		liveMessages: timeline.dynamicItems.filter((item) => item.type === "message").map((item) => item.message),
		taskSwitchKey: timeline.taskSwitchKey,
		setTaskSwitchKey: timeline.setTaskSwitchKey,
	}
}

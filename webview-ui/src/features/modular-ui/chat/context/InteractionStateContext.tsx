import React, { createContext, useContext, useMemo } from "react"
import { CardStatus, DiracMessage, DiracMessageType, isFinalStatus, TaskStatus } from "@shared/ExtensionMessage"
import { isBusyTaskStatus } from "@shared/taskStatusProjection"
import { useChatStore } from "@/features/chat/store/chatStore"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import { useShallow } from "zustand/react/shallow"
export enum InteractionState {
	IDLE = "idle",
	RUNNING = "running",
	AWAITING_RESPONSE = "awaiting_response",
	COMPLETED = "completed",
}

interface InteractionStateContextType {
	state: InteractionState
	isPlanMode: boolean
}

const InteractionStateContext = createContext<InteractionStateContextType | undefined>(undefined)

export function projectInteractionState(params: {
	hasTask: boolean
	activeVoiceStreamId?: string
	isApiRequestActive?: boolean
	activeCardMessage?: DiracMessage
	taskStatus?: TaskStatus
}): InteractionState {
	const { hasTask, activeVoiceStreamId, isApiRequestActive, activeCardMessage, taskStatus } = params
	if (taskStatus === TaskStatus.IDLE || !hasTask) return InteractionState.IDLE
	if (taskStatus === TaskStatus.COMPLETED) return InteractionState.COMPLETED
	if (taskStatus === TaskStatus.CANCELLED || taskStatus === TaskStatus.AWAITING_USER_INPUT) {
		return InteractionState.AWAITING_RESPONSE
	}

	if (activeCardMessage?.content.type === DiracMessageType.CARD) {
		const card = activeCardMessage.content.card
		if (
			!isFinalStatus(card.status) &&
			(card.status === CardStatus.WAITING_FOR_INPUT ||
				card.requireApproval ||
				card.requireFeedback ||
				(card.actions?.length ?? 0) > 0)
		) {
			return InteractionState.AWAITING_RESPONSE
		}
	}

	if (isApiRequestActive || activeVoiceStreamId || isBusyTaskStatus(taskStatus)) return InteractionState.RUNNING
	return InteractionState.RUNNING
}


export const InteractionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { activeVoiceStreamId, isApiRequestActive, taskStatus, activeCardMessage, taskMessage } = useChatStore(
		useShallow((state) => {
			const activeCardId = state.uiActionState?.activeCardId
			const activeCardIndex = activeCardId ? state.messageIndexById.get(activeCardId) : undefined
			return {
				activeVoiceStreamId: state.activeVoiceStreamId,
				isApiRequestActive: state.isApiRequestActive,
				taskStatus: state.taskStatus,
				activeCardMessage: activeCardIndex === undefined ? undefined : state.diracMessages[activeCardIndex],
				taskMessage: state.taskMessage,
			}
		}),
	)
	const mode = useSettingsStore((state: any) => state.mode)

	const interactionState = useMemo(
		() =>
			projectInteractionState({
				hasTask: taskMessage !== undefined,
				activeVoiceStreamId,
				isApiRequestActive,
				activeCardMessage,
				taskStatus,
			}),
		[activeCardMessage, activeVoiceStreamId, isApiRequestActive, taskMessage, taskStatus],
	)

	const value = useMemo(
		() => ({
			state: interactionState,
			isPlanMode: mode === "plan",
		}),
		[interactionState, mode],
	)

	return <InteractionStateContext.Provider value={value}>{children}</InteractionStateContext.Provider>
}

export const useInteractionState = () => {
	const context = useContext(InteractionStateContext)
	if (context === undefined) {
		throw new Error("useInteractionState must be used within an InteractionStateProvider")
	}
	return context
}

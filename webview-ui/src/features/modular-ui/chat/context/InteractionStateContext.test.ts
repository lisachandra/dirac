import { CardKind, CardStatus, DiracMessageType, TaskStatus } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { InteractionState, projectInteractionState } from "./InteractionStateContext"


function cardMessage(status: CardStatus) {
	return {
		id: "card-message",
		ts: 2,
		content: {
			type: DiracMessageType.CARD,
			card: {
				id: "card",
				kind: CardKind.GENERIC,
				header: "Question",
				status,
				renderType: "text" as const,
				requireFeedback: true,
			},
		},
	}
}

describe("projectInteractionState", () => {
	it("prioritizes a waiting card over a busy transport flag", () => {
		expect(
			projectInteractionState({
				hasTask: true,
				activeCardMessage: cardMessage(CardStatus.WAITING_FOR_INPUT),
				isApiRequestActive: true,
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.AWAITING_RESPONSE)
	})

	it("keeps authoritative completion despite a busy transport flag", () => {
		expect(
			projectInteractionState({
				hasTask: true,
				isApiRequestActive: true,
				taskStatus: TaskStatus.COMPLETED,
			}),
		).toBe(InteractionState.COMPLETED)
	})

	it("does not treat a terminal active card as an outstanding response", () => {
		expect(
			projectInteractionState({
				hasTask: true,
				activeCardMessage: cardMessage(CardStatus.SUCCESS),
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.RUNNING)
	})

	it("keeps a task running when it has no active card", () => {
		expect(
			projectInteractionState({
				hasTask: true,
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.RUNNING)
	})

	it("is idle only when no task exists", () => {
		expect(
			projectInteractionState({
				hasTask: false,
				taskStatus: TaskStatus.EXECUTING_TOOL,
			}),
		).toBe(InteractionState.IDLE)
	})
})

import type { Card, DiracApiReqInfo, DiracMessage } from "./ExtensionMessage"
import { DiracMessageType } from "./ExtensionMessage"

export type PresentationOperation =
	| { offset: number; type: "create"; message: DiracMessage }
	| { offset: number; type: "patch_message"; id: string; patch: Partial<Omit<DiracMessage, "id">> }
	| { offset: number; type: "patch_card"; id: string; patch: Partial<Omit<Card, "id">> }
	| {
			offset: number
			type: "patch_markdown"
			id: string
			patch: Partial<Omit<Extract<DiracMessage["content"], { type: DiracMessageType.MARKDOWN }>, "type" | "content">>
	  }
	| { offset: number; type: "append_markdown"; id: string; text: string }
	| { offset: number; type: "append_card_body"; id: string; text: string }
	| {
			offset: number
			type: "patch_api_status"
			id: string
			patch: Partial<DiracApiReqInfo>
			deletions?: (keyof DiracApiReqInfo)[]
	  }
	| { offset: number; type: "delete"; id: string }
	| { offset: number; type: "reset"; messages: DiracMessage[] }

export interface PresentationBatch {
	surfaceId: string
	operations: PresentationOperation[]
}

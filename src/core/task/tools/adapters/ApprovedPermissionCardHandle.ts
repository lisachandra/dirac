import { CardStatus } from "@shared/ExtensionMessage"
import { DiracAskResponse } from "@shared/WebviewMessage"
import type { CardParams, ICardHandle } from "../interfaces/IToolEnvironment"

let nextApprovedPermissionId = 1

/** Invisible card-shaped result used when a tool permission is approved without interaction. */
export class ApprovedPermissionCardHandle implements ICardHandle {
	public readonly id = `approved-permission-${nextApprovedPermissionId++}`
	public readonly requiresUserInteraction = false
	public header: string
	public icon?: string
	public status: CardStatus
	public renderType: CardParams["renderType"] extends infer T ? NonNullable<T> : never
	public body?: string
	public rawInput?: CardParams["rawInput"]
	public rawOutput?: CardParams["rawOutput"]
	public locations?: CardParams["locations"]
	public requireApproval?: boolean
	public requireFeedback?: boolean
	public feedbackPlaceholder?: string
	public actions?: CardParams["actions"]
	public collapsed: boolean
	public maxHeight?: number
	public cleanupStrategy?: CardParams["cleanupStrategy"]

	constructor(params: CardParams) {
		this.header = params.header
		this.icon = params.icon
		this.status = params.status ?? CardStatus.RUNNING
		this.renderType = params.renderType ?? "text"
		this.body = params.body
		this.rawInput = params.rawInput
		this.rawOutput = params.rawOutput
		this.locations = params.locations
		this.requireApproval = params.requireApproval
		this.requireFeedback = params.requireFeedback
		this.feedbackPlaceholder = params.feedbackPlaceholder
		this.actions = params.actions
		this.collapsed = params.collapsed ?? true
		this.maxHeight = params.maxHeight
		this.cleanupStrategy = params.cleanupStrategy
	}

	async update(patch: Parameters<ICardHandle["update"]>[0]): Promise<void> {
		if (patch.header !== undefined) this.header = patch.header
		if (patch.icon !== undefined) this.icon = patch.icon
		if (patch.status !== undefined) this.status = patch.status
		if (patch.renderType !== undefined) this.renderType = patch.renderType
		if (patch.body !== undefined) this.body = patch.body
		if (patch.rawInput !== undefined) this.rawInput = patch.rawInput
		if (patch.rawOutput !== undefined) this.rawOutput = patch.rawOutput
		if (patch.locations !== undefined) this.locations = patch.locations
		if (patch.requireApproval !== undefined) this.requireApproval = patch.requireApproval
		if (patch.requireFeedback !== undefined) this.requireFeedback = patch.requireFeedback
		if (patch.feedbackPlaceholder !== undefined) this.feedbackPlaceholder = patch.feedbackPlaceholder
		if (patch.actions !== undefined) this.actions = patch.actions
		if (patch.collapsed !== undefined) this.collapsed = patch.collapsed
		if (patch.maxHeight !== undefined) this.maxHeight = patch.maxHeight
		if (patch.cleanupStrategy !== undefined) this.cleanupStrategy = patch.cleanupStrategy
	}

	async waitForInteraction(): ReturnType<ICardHandle["waitForInteraction"]> {
		const action = this.actions?.find((candidate) => candidate.primary)?.value ?? DiracAskResponse.APPROVE
		return { action, response: DiracAskResponse.APPROVE, value: action }
	}

	async appendBody(chunk: string): Promise<void> {
		this.body = `${this.body ?? ""}${chunk}`
	}

	async finalize(status: CardStatus): Promise<void> {
		this.status = status
		this.collapsed = true
	}
}

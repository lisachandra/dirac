import { ConversationCondensationService } from "@core/text-condensation/ConversationCondensationService"
import { createDefaultTextCondensationTemplateRegistry } from "@core/text-condensation/templates"
import { UtilityModelTextCondenser } from "@core/text-condensation/UtilityModelTextCondenser"
import {
	getConfiguredUtilityModelSelection,
	isUtilityTextCondensationAvailable,
} from "@core/text-condensation/UtilityTextCondensationAvailability"
import type { ModelProviderSelection } from "@shared/api"
import type { IConversationCondensationTrait } from "../../interfaces/IToolEnvironment"
import type { TaskConfig } from "../../types/TaskConfig"

export class ConversationCondensationUnavailableError extends Error {
	constructor() {
		super("Conversation condensation is unavailable")
		this.name = "ConversationCondensationUnavailableError"
	}
}

export function buildConversationCondensationTrait(config: TaskConfig): IConversationCondensationTrait {
	const templates = createDefaultTextCondensationTemplateRegistry()

	return {
		isAvailable: (template) =>
			isUtilityTextCondensationAvailable(
				{
					utilityModelEnabled: config.utilityModelEnabled,
					utilityModelUseCondense: config.utilityModelUseCondense,
					utilityModelUseNewTask: config.utilityModelUseNewTask,
					utilityModelSelection: config.utilityModelSelection,
				},
				template,
				templates,
			),
		condenseConversation: async (template, options) => {
			const settings = {
				utilityModelEnabled: config.utilityModelEnabled,
				utilityModelUseCondense: config.utilityModelUseCondense,
				utilityModelUseNewTask: config.utilityModelUseNewTask,
				utilityModelSelection: config.utilityModelSelection,
			}
			const selection = getConfiguredUtilityModelSelection(settings.utilityModelSelection)
			if (!isUtilityTextCondensationAvailable(settings, template, templates) || !selection) {
				throw new ConversationCondensationUnavailableError()
			}

			let resolvedModelId: string | undefined
			const service = createConversationCondensationService(config, selection, templates, (modelId) => {
				resolvedModelId = modelId
			})
			const text = await service.condenseConversation(template, options)
			if (!resolvedModelId) throw new Error("Conversation condensation completed without resolving a Utility model")
			return {
				text,
				modelIdentity: {
					providerId: selection.provider,
					modelId: resolvedModelId,
				},
			}
		},
	}
}

function createConversationCondensationService(
	config: TaskConfig,
	selection: ModelProviderSelection,
	templates: ReturnType<typeof createDefaultTextCondensationTemplateRegistry>,
	onModelResolved: (modelId: string) => void,
): ConversationCondensationService {
	const runner = config.callbacks.createUtilityModelRunner(selection, {
		ulid: config.ulid,
		onModelResolved: ({ modelId }) => onModelResolved(modelId),
	})
	const textCondenser = new UtilityModelTextCondenser(runner, templates)

	return new ConversationCondensationService({
		messageState: config.messageState,
		contextManager: config.services.contextManager,
		getConversationHistoryDeletedRange: () => config.taskState.conversationHistoryDeletedRange,
		textCondenser,
	})
}

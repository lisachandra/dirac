import ActionButtons from "../../components/ActionButtons"
import { ChatViewContext, ChatViewDecorator } from "../../types"

export const ActionButtonsDecorator: ChatViewDecorator = {
	id: "action-buttons",
	render: (context: ChatViewContext) => (
		<ActionButtons
			chatState={context.chatState}
			messageHandlers={context.messageHandlers}
			scrollBehavior={{
				scrollToBottomSmooth: context.scrollBehavior.scrollToBottomSmooth,
				scrollToTop: context.scrollBehavior.scrollToTop,
				showScrollToBottom: context.scrollBehavior.showScrollToBottom,
			}}
			task={context.task}
		/>
	),
}

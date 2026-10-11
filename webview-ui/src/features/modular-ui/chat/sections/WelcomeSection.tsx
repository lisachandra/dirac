import ModularWelcomeSection from "../components/ModularWelcomeSection"
import { ChatSection, ChatViewContext } from "../types"

export const WelcomeSection: ChatSection = {
	id: "welcome",
	shouldRender: (context) => !context.task && !context.goal,
	render: (context: ChatViewContext) => (
		<ModularWelcomeSection
			shouldShowQuickWins={context.shouldShowQuickWins}
			showHistoryView={context.showHistoryView}
			showAnnouncement={context.showAnnouncement}
			hideAnnouncement={context.hideAnnouncement}
			version={context.version}
		/>
	),
}

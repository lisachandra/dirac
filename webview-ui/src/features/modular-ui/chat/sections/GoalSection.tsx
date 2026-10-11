import GoalHeader from "../components/GoalHeader/GoalHeader"
import type { ChatSection, ChatViewContext } from "../types"

export const GoalSection: ChatSection = {
	id: "goal-header",
	shouldRender: (context) => !!context.goal,
	render: (context: ChatViewContext) => {
		const goal = context.goal
		return goal ? <GoalHeader goal={goal} key={goal.id} /> : null
	},
}

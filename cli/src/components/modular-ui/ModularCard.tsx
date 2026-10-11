import { Card as CardType, isFinalStatus } from "@shared/ExtensionMessage"
import { Box } from "ink"
import React from "react"
import { getIconCategoryColor } from "../../utils/icon-mapping"
import { CardBody } from "./CardBody"
import { CardHeader } from "./CardHeader"
import { CardInteractions } from "./CardInteractions"

interface ModularCardProps {
	card: CardType
	scrollOffset?: number
	maxBodyLines?: number
	suppressBody?: boolean
}

export const ModularCard: React.FC<ModularCardProps> = ({
	card,
	maxBodyLines,
	scrollOffset,
	suppressBody = false,
}) => {
	const { header, status, body, renderType, icon, requireFeedback, actions } = card
	const categoryColor = getIconCategoryColor(icon)

	return (
		<Box
			borderBottom={false}
			borderColor={categoryColor}
			borderLeft
			borderRight={false}
			borderStyle="single"
			borderTop={false}
			flexDirection="column"
			paddingLeft={1}>
			<CardHeader header={header} icon={icon} isCollapsed={false} status={status} />
			{body && !suppressBody && (
				<Box flexDirection="column" paddingLeft={4}>
					<CardBody body={body} maxLines={maxBodyLines} renderType={renderType} scrollOffset={scrollOffset} />
				</Box>
			)}
			{!isFinalStatus(status) && (
				<CardInteractions
					actions={actions}
					feedbackPlaceholder={card.feedbackPlaceholder}
					requireFeedback={requireFeedback}
				/>
			)}
		</Box>
	)
}

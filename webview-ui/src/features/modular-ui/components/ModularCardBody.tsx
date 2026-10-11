import { Card } from "@shared/ExtensionMessage"
import { formatSubagentTrajectory, readSubagentCardData } from "@shared/subagents"
import { CARD_DECORATORS } from "../decorators"
import { CardContent } from "./CardContent"
import { CardActions } from "./CardActions"
import React, { useMemo } from "react"

interface ModularCardBodyProps {
	card: Card
	isActive?: boolean
	onAction?: (value: string) => void
	scrollRef?: React.Ref<HTMLDivElement>
}

export const SUBAGENT_CARD_MAX_HEIGHT_PX = 320

export function resolveCardBodyPresentation(card: Card): { body?: string; maxHeight?: number } {
	const subagentData = readSubagentCardData(card)
	if (!subagentData) return { body: card.body, maxHeight: card.maxHeight }
	return {
		body: formatSubagentTrajectory(subagentData, { includeToolResults: false }),
		maxHeight: SUBAGENT_CARD_MAX_HEIGHT_PX,
	}
}

export const ModularCardBody: React.FC<ModularCardBodyProps> = ({ card, isActive, onAction, scrollRef }) => {
	const { renderType } = card
	const decorators = useMemo(() => CARD_DECORATORS.filter((d) => d.shouldApply(card)), [card])
	const presentation = useMemo(() => resolveCardBodyPresentation(card), [card])

	// Find the first decorator that provides a body wrapper
	const bodyWrapper = decorators.find((d) => d.renderBodyWrapper)
	const suppressDefaultActions = decorators.some((d) => d.suppressDefaultActions)
	const bodyContent = presentation.body && (
		<div
			className="overflow-x-auto overflow-y-auto p-2.5 text-sm leading-relaxed"
			ref={scrollRef}
			style={{ maxHeight: presentation.maxHeight ? `${presentation.maxHeight}px` : "320px" }}>
			<CardContent
				body={presentation.body}
				messageId={card.id}
				renderType={renderType}
				streaming={card.status === "running" && presentation.body === card.body}
			/>
		</div>
	)

	return (
		<div className="flex flex-col border-t border-foreground/10">
			{presentation.body && (bodyWrapper ? bodyWrapper.renderBodyWrapper!(card, bodyContent) : bodyContent)}

			{decorators.map((d) => (
				<React.Fragment key={d.id}>{d.renderFooterExtra?.(card, onAction, isActive)}</React.Fragment>
			))}

			{!suppressDefaultActions && <CardActions card={card} isActive={isActive} onAction={onAction} />}
		</div>
	)
}

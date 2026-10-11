import { useLayoutEffect, useRef } from "react"
import { useChatStore } from "@/features/chat/store/chatStore"

interface IncrementalTextProps {
	messageId: string
	initialText: string
	className?: string
}

/** Appends streamed chunks directly to one text node so prior prefixes are not copied or reconciled. */
export function IncrementalText({ messageId, initialText, className }: IncrementalTextProps) {
	const append = useChatStore((state) => state.presentationAppends.get(messageId))
	const elementRef = useRef<HTMLPreElement | null>(null)
	const appliedChunkCount = useRef(0)
	const appliedInitialText = useRef(initialText)
	const appliedMessageId = useRef(messageId)

	useLayoutEffect(() => {
		const element = elementRef.current
		if (!element) return
		const firstChild = element.firstChild
		let textNode: Text
		if (firstChild instanceof Text) {
			textNode = firstChild
		} else {
			textNode = document.createTextNode(initialText)
			element.replaceChildren(textNode)
		}
		if (
			appliedMessageId.current !== messageId ||
			appliedInitialText.current !== initialText ||
			appliedChunkCount.current > (append?.chunks.length ?? 0)
		) {
			textNode.data = initialText
			appliedMessageId.current = messageId
			appliedInitialText.current = initialText
			appliedChunkCount.current = 0
		}
		for (const chunk of append?.chunks.slice(appliedChunkCount.current) ?? []) textNode.appendData(chunk)
		appliedChunkCount.current = append?.chunks.length ?? 0
	}, [append, initialText, messageId])

	return (
		<pre className={className} ref={elementRef}>
			{initialText}
		</pre>
	)
}

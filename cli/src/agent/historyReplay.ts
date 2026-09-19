import type { DiracMessage } from "@shared/ExtensionMessage";

/**
 * Collapse a stored task history into the states that still matter.
 *
 * Dirac persists every intermediate version of a message: a streaming answer or
 * a card that walks RUNNING -> SUCCESS appears as many entries sharing one
 * message id. Replaying all of them over ACP produces one client notification
 * per version, which for large tasks means tens of thousands of notifications
 * and a client that rewrites its own timeline file for each of them.
 *
 * Only the last version of each message is rendered, so replayed history keeps
 * the original message order while emitting each message once.
 */
export function collapseHistoryMessages(
	messages: readonly DiracMessage[],
): DiracMessage[] {
	const positionById = new Map<string, number>();
	const collapsed: DiracMessage[] = [];

	for (const message of messages) {
		const position = positionById.get(message.id);

		if (position === undefined) {
			positionById.set(message.id, collapsed.length);
			collapsed.push(message);
			continue;
		}

		collapsed[position] = message;
	}

	return collapsed;
}

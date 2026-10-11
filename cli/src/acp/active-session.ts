export type ActiveAcpSessionIdResolver = () => string | undefined

export function requireActiveAcpSessionId(resolver: ActiveAcpSessionIdResolver, operation: string): string {
	const sessionId = resolver()
	if (!sessionId) {
		throw new Error(`No active ACP session for ${operation}.`)
	}
	return sessionId
}

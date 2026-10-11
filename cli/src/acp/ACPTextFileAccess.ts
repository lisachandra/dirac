import type * as acp from "@agentclientprotocol/sdk"
import type { TextFileAccess, TextFileReadResult, TextFileWriteResult } from "@/integrations/editor/TextFileAccess"
import { requireActiveAcpSessionId, type ActiveAcpSessionIdResolver } from "./active-session.js"

export class ACPTextFileAccess implements TextFileAccess {
	constructor(
		private readonly connection: acp.AgentSideConnection,
		private readonly clientCapabilities: acp.ClientCapabilities | undefined,
		private readonly sessionIdResolver: ActiveAcpSessionIdResolver,
		private readonly nodeTextFileAccess: TextFileAccess,
	) {}

	async readText(path: string): Promise<TextFileReadResult> {
		if (this.clientCapabilities?.fs?.readTextFile !== true) {
			return this.nodeTextFileAccess.readText(path)
		}

		const sessionId = requireActiveAcpSessionId(this.sessionIdResolver, `reading ${path}`)
		const response = await this.connection.readTextFile({ sessionId, path })
		return { content: response.content, encoding: "utf8" }
	}

	async writeText(path: string, content: string): Promise<TextFileWriteResult> {
		if (this.clientCapabilities?.fs?.writeTextFile !== true) {
			return this.nodeTextFileAccess.writeText(path, content)
		}

		const sessionId = requireActiveAcpSessionId(this.sessionIdResolver, `writing ${path}`)
		await this.connection.writeTextFile({ sessionId, path, content })

		if (this.clientCapabilities.fs?.readTextFile !== true) {
			return { content }
		}

		const readSessionId = requireActiveAcpSessionId(this.sessionIdResolver, `reading back ${path}`)
		if (readSessionId !== sessionId) {
			throw new Error(`Active ACP session changed while writing ${path}; refusing cross-session read-back.`)
		}
		const response = await this.connection.readTextFile({ sessionId: readSessionId, path })
		return { content: response.content }
	}
}

import { strict as assert } from "node:assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { CardStatus, DiracMessage, DiracMessageType } from "@shared/ExtensionMessage"
import type { DiracStorageMessage } from "@/shared/messages/content"
import { HostProvider } from "@/hosts/host-provider"
import { RuleContextBuilder, RuleContextBuilderDeps } from "../RuleContextBuilder"

function markdownMessage(id: string, content: string, role: "user" | "assistant"): DiracMessage {
	return {
		id,
		ts: Number(id.replace(/\D/g, "")) || 1,
		content: { type: DiracMessageType.MARKDOWN, content, role },
	}
}

function cardMessage(
	id: string,
	body: string,
	metadata: {
		locations?: Array<{ path: string; line?: number }>
		diffs?: Array<{ path: string; oldText: string; newText: string }>
	} = {},
): DiracMessage {
	return {
		id,
		ts: Number(id.replace(/\D/g, "")) || 1,
		content: {
			type: DiracMessageType.CARD,
			card: {
				id,
				header: "Tool card",
				status: CardStatus.SUCCESS,
				renderType: "text",
				body,
				...metadata,
			},
		},
	}
}

function dependencies(messages: DiracMessage[], history: DiracStorageMessage[] = []): RuleContextBuilderDeps {
	return {
		cwd: "/workspace",
		workspaceManager: { getRoots: () => [{ path: "/workspace" }] },
		messageStateHandler: {
			getDiracMessages: () => messages,
			getApiConversationHistory: () => history,
		},
	}
}

function toolUse(id: string, input: Record<string, unknown>) {
	return { type: "tool_use" as const, id, name: `tool-${id}`, input }
}

describe("RuleContextBuilder", () => {
	beforeEach(() => {
		sinon.stub(HostProvider, "window").value({
			getVisibleTabs: sinon.stub().resolves({ paths: [] }),
			getOpenTabs: sinon.stub().resolves({ paths: [] }),
		})
	})

	afterEach(() => sinon.restore())

	it("ignores plain-text card bodies instead of parsing them as JSON", async () => {
		const parse = sinon.stub(JSON, "parse").throws(new Error("card bodies must not be parsed"))
		const messages = [cardMessage("card-1", "Pong."), cardMessage("card-2", "Executed:\n```\noutput\n```")]

		const context = await new RuleContextBuilder().buildEvaluationContext(dependencies(messages))

		assert.deepEqual(context.paths, [])
		sinon.assert.notCalled(parse)
	})

	it("combines user, tab, tool-input, location, and diff paths", async () => {
		const windowClient = HostProvider.window as any
		windowClient.getVisibleTabs.resolves({ paths: ["/workspace/src/visible.ts"] })
		windowClient.getOpenTabs.resolves({ paths: ["/workspace/src/open.ts"] })

		const messages = [
			markdownMessage("message-1", "Please update src/from-user.ts", "user"),
			markdownMessage("message-2", "Assistant mentioned src/from-assistant.ts", "assistant"),
			cardMessage("card-3", "Human-readable result", {
				locations: [{ path: "src/from-location.ts", line: 7 }],
				diffs: [{ path: "src/from-diff.ts", oldText: "old", newText: "new" }],
			}),
		]
		const history: DiracStorageMessage[] = [
			{
				role: "assistant",
				content: [
					toolUse("1", { path: "src/singular.ts" }),
					toolUse("2", { file_path: "src/snake-alias.ts" }),
					toolUse("3", { filePath: "src/camel-alias.ts" }),
					toolUse("4", { paths: ["src/plural-a.ts", "src/plural-b.ts", "src/singular.ts"] }),
					toolUse("5", { files: [{ path: "src/nested-file.ts" }] }),
					toolUse("6", { targets: [{ path: "src/nested-target.ts" }] }),
				],
			},
		]

		const context = await new RuleContextBuilder().buildEvaluationContext(dependencies(messages, history))

		assert.deepEqual(context.paths, [
			"src/camel-alias.ts",
			"src/from-diff.ts",
			"src/from-location.ts",
			"src/from-user.ts",
			"src/nested-file.ts",
			"src/nested-target.ts",
			"src/open.ts",
			"src/plural-a.ts",
			"src/plural-b.ts",
			"src/singular.ts",
			"src/snake-alias.ts",
			"src/visible.ts",
		])
	})
})

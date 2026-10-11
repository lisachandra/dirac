import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { DiracDefaultTool, type DiracToolSpec } from "@shared/tools"
import { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import type { IDiracTool } from "../interfaces/IDiracTool"
import type { IToolEnvironment } from "../interfaces/IToolEnvironment"
import { createMockTaskConfig } from "./helpers/mockTaskConfig"

class UnfinalizedCardTool implements IDiracTool {
	constructor(private readonly failExecution: boolean) {}

	spec(): DiracToolSpec {
		return { id: DiracDefaultTool.RESPOND, name: DiracDefaultTool.RESPOND, description: "test", parameters: [] }
	}

	supportedSurfaces() {
		return ["all" as const]
	}

	async processCall(_args: unknown, env: IToolEnvironment): Promise<string> {
		await env.ui.createCard({ header: "Unfinalized test card" })
		if (this.failExecution) throw new Error("expected tool failure")
		return "done"
	}
}

function block() {
	return {
		type: "tool_use" as const,
		name: DiracDefaultTool.RESPOND,
		params: {},
	}
}

describe("ToolExecutorCoordinator card finalization", () => {
	it("rejects an unfinalized card after a successful tool result", async () => {
		const { config } = createMockTaskConfig()
		const coordinator = new ToolExecutorCoordinator()
		coordinator.registerModularTool(new UnfinalizedCardTool(false))

		await assert.rejects(() => coordinator.execute(config, block()), /left nonterminal card\(s\).*mock-card-\d+ \(running\)/)
	})

	it("rejects an unfinalized card after a failed tool result", async () => {
		const { config } = createMockTaskConfig()
		const coordinator = new ToolExecutorCoordinator()
		coordinator.registerModularTool(new UnfinalizedCardTool(true))

		await assert.rejects(
			() => coordinator.execute(config, block()),
			/left nonterminal card\(s\).*mock-card-\d+ \(running\).*Original execution error: expected tool failure/,
		)
	})
})

import type { ToolUse } from "@core/assistant-message"
import { DiracDefaultTool } from "@/shared/tools"
import { CardStatus, isFinalStatus } from "../../../shared/ExtensionMessage"
import { SurfaceToolEnvironmentFactory } from "./adapters/SurfaceAdapter"
import type { ToolEnvironmentFactory } from "./interfaces/ToolEnvironmentFactory"

import { IDiracTool } from "./interfaces/IDiracTool"
import { SurfaceType } from "./interfaces/SurfaceType"
import { assertValidToolResponse } from "./runtime/assertValidToolResponse"
import { normalizeOptionalToolParameters } from "./runtime/normalizeOptionalToolParameters"
import { AgentConfigLoader } from "./subagent/AgentConfigLoader"
import type { TaskConfig } from "./types/TaskConfig"
import type { ToolResponse } from "./types/ToolResponse"
import { ToolSkippedByUserMessage } from "./types/ToolSkippedByUserMessage"
import { createUIHelpers } from "./types/UIHelpers"
import { formatResponse } from "@core/formatResponse"
import { ToolTimeoutError } from "./runtime/ToolExecutionDeadline"

interface PartialToolUseHandler extends IDiracTool {
	bufferPartialToolUse(block: ToolUse, uiHelpers: ReturnType<typeof createUIHelpers>): Promise<void>
}

/**
 * Coordinates tool execution by routing to registered handlers.
 * Throws an error for unregistered tools.
 */
export class ToolExecutorCoordinator {
	constructor(private readonly environmentFactory: ToolEnvironmentFactory = new SurfaceToolEnvironmentFactory()) {}

	createEmptySibling(): ToolExecutorCoordinator {
		return new ToolExecutorCoordinator(this.environmentFactory)
	}

	private modularTools = new Map<string, IDiracTool>()

	async bufferPartialToolUse(block: ToolUse, config: TaskConfig): Promise<void> {
		const modularTool = this.modularTools.get(block.name)
		if (modularTool && "bufferPartialToolUse" in modularTool) {
			const uiHelpers = createUIHelpers(config)
			await (modularTool as PartialToolUseHandler).bufferPartialToolUse(block, uiHelpers)
		}
	}

	registerModularTool(tool: IDiracTool): void {
		const spec = tool.spec()
		const name = spec.name
		if (name) {
			this.modularTools.set(name, tool)
		}
	}

	has(toolName: string): boolean {
		if (this.modularTools.has(toolName)) {
			return true
		}

		return (
			AgentConfigLoader.getInstance().isDynamicSubagentTool(toolName) &&
			this.modularTools.has(DiracDefaultTool.USE_SUBAGENTS)
		)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const modularTool = this.modularTools.get(block.name)

		if (!modularTool && AgentConfigLoader.getInstance().isDynamicSubagentTool(block.name)) {
			const subagentTool = this.modularTools.get(DiracDefaultTool.USE_SUBAGENTS)
			if (subagentTool) {
				return this.executeModularTool(subagentTool, config, block)
			}
		}

		if (modularTool) {
			return this.executeModularTool(modularTool, config, block)
		}

		throw new Error(`No modular tool registered for: ${block.name}`)
	}

	private async executeModularTool(tool: IDiracTool, config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const startTime = Date.now()
		const requestSnapshot = config.activeToolSnapshot
		const nativeTool = requestSnapshot?.nativeTools.find(
			(candidate) => "function" in candidate && candidate.function.name === block.name,
		)
		if (requestSnapshot && nativeTool && "function" in nativeTool && nativeTool.function.strict === true) {
			const requestSpec = requestSnapshot.promptVisibleSpecs.find((spec) => spec.name === block.name) ?? tool.spec()
			block.params = normalizeOptionalToolParameters(block.params, requestSpec)
		}

		// 1. Initialize Tool Environment (Surface Adapter)
		// Preserve live task-setting accessors while adding call-specific metadata.
		const toolConfig = Object.create(Object.getPrototypeOf(config), Object.getOwnPropertyDescriptors(config)) as TaskConfig
		toolConfig.toolUse = { name: block.name, params: block.params }
		const env = this.environmentFactory.create(toolConfig, block.name)

		// 2. Filter (Surface Check)
		const supported = tool.supportedSurfaces()
		const currentSurface: SurfaceType = config.vscodeTerminalExecutionMode === "vscodeTerminal" ? "ide" : "cli"

		if (supported.length > 0 && !supported.includes("all") && !supported.includes(currentSurface)) {
			const error = new Error(`Surface mismatch: ${currentSurface}`)
			return `Tool '${block.name}' is not supported on the current surface (${currentSurface}).`
		}

		// 3. Pre-tool Hooks
		try {
			const { ToolHookUtils } = await import("./utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error: any) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				// Must be visible in ACP as a failed tool_call, not just LLM text
				const reason = `Blocked by PreToolUse hook: ${error.message}`
				try {
					const cancelCard = await config.taskMessenger.createCard({
						header: `Blocked: ${block.name}`,
						body: reason,
						status: "error" as any,
						toolName: (block as any).name,
					} as any)
					await (cancelCard as any).finalize?.("error")
				} catch {}
				return `Cancelled by pre-tool hook: ${error.message}`
			}
			throw error
		}

		// 4. Observability: "Calling..." (Removed redundant message)

		let executionSuccess = false
		let response!: ToolResponse
		let executionError: Error | undefined

		const initialMistakeCount = config.taskState.consecutiveMistakeCount
		const unfinalizedCards: { id: string; status: CardStatus }[] = []
		try {
			// 5. Execute (Dispatcher)
			const result = await tool.processCall(block.params, env)
			assertValidToolResponse(result, block.name)
			executionSuccess = true

			// 6. Persist Context
			await env.context.save()

			// 7. Observability: "Finished..." (Removed redundant message)

			// 8. Update Mistake Count (Success)
			config.taskState.consecutiveMistakeCount =
				config.taskState.consecutiveMistakeCount > initialMistakeCount ? initialMistakeCount + 1 : 0

			// 9. Store Result
			response = result
		} catch (error: any) {
			executionSuccess = false

			if (error instanceof ToolSkippedByUserMessage) {
				config.taskState.consecutiveMistakeCount = initialMistakeCount
				config.taskState.pendingUserMessage = error.userMessage
				config.taskState.pendingUserImages = error.userImages
				config.taskState.pendingUserFiles = error.userFiles

				for (const card of env.getCreatedCards()) {
					if (!isFinalStatus(card.status)) {
						await card.finalize(CardStatus.SKIPPED)
					}
				}

				env.telemetry.captureCustomMetadata({ skippedByUser: true, userMessageLength: error.userMessage.length })
				response = `[Tool '${block.name}' skipped by user with message: "${error.userMessage}"]`
			} else {
				executionError = error instanceof Error ? error : new Error(String(error))
				config.taskState.consecutiveMistakeCount = initialMistakeCount + 1
				if (executionError instanceof ToolTimeoutError) {
					env.telemetry.captureCustomMetadata({
						timedOut: true,
						timeoutMs: executionError.timeoutMs,
						timeoutOperation: executionError.operation,
					})
					response = formatResponse.toolTimeout(
						executionError.toolName,
						executionError.operation,
						executionError.timeoutMs,
					)
				} else {
					response = `Execution failed: ${error.message || error}`
				}
			}
		} finally {
			// 12. Telemetry
			const duration = Date.now() - startTime
			const customMetadata = env.getCustomMetadata()

			const { telemetryService } = await import("@/services/telemetry")

			const modelId = config.model.id
			const providerId = config.providerId

			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				modelId,
				providerId,
				false, // didAutoApprove
				executionSuccess,
				{
					...customMetadata,
					durationMs: duration,
					modular: true,
				},
				block.isNativeToolCall,
			)

			// 13. Collect unfinalized cards — assert after finally to avoid unsafe throw
			for (const card of env.getCreatedCards()) {
				if (!isFinalStatus(card.status) && card.cleanupStrategy !== "keep_running") {
					unfinalizedCards.push({ id: card.id, status: card.status })
				}
			}
		}

		// Assert tools finalized their own cards — no defensive finalization
		if (unfinalizedCards.length > 0) {
			throw new Error(
				`Tool '${block.name}' left nonterminal card(s): ${unfinalizedCards.map((c) => `${c.id} (${c.status})`).join(", ")}${executionError ? `. Original execution error: ${executionError.message}` : ""}`,
			)
		}
		return response
	}
}

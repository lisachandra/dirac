import { exit } from "node:process"
import { isGoalHistoryItem } from "@shared/HistoryItem"
import type { CliContext, TaskOptions } from "../types"
import { setIsPlainTextMode } from "../utils/state"
import { disposeCliContext, drainOutput, createInkCleanup } from "../utils/cleanup"
import { isGoalRequest, UNSUPPORTED_GOAL_CLI_MESSAGE } from "../utils/goals"
import { getPlainTextModeReason, shouldUsePlainTextMode } from "../utils/mode"
import { applyTaskOptions } from "../utils/options"
import { initializeCli } from "../init"
import { runInkApp } from "../utils/ink"

/**
 * Run a task in plain text mode (no Ink UI).
 * Handles auth check, task execution, cleanup, and exit.
 */
export async function runTaskInPlainTextMode(
	ctx: CliContext,
	options: TaskOptions,
	taskConfig: {
		prompt?: string
		taskId?: string
		imageDataUrls?: string[]
		timeoutSeconds?: number
	},
): Promise<never> {
	const { isAuthConfigured } = await import("../utils/auth")
	const { printWarning } = await import("../utils/display")
	const { telemetryService } = await import("@/services/telemetry")
	const { runPlainTextTask } = await import("../utils/plain-text-task")
	const historyItem = taskConfig.taskId
		? ctx.controller.stateManager
			.getGlobalStateKey("taskHistory")
			.find((item: { id: string }) => item.id === taskConfig.taskId)
		: undefined
	if (isGoalRequest(taskConfig.prompt) || (historyItem && isGoalHistoryItem(historyItem))) {
		printWarning(UNSUPPORTED_GOAL_CLI_MESSAGE)
		await disposeCliContext(ctx)
		await drainOutput()
		exit(1)
	}

	// Set flag so shutdown handler knows not to clear Ink UI lines
	setIsPlainTextMode(true)

	// Check if auth is configured before attempting to run the task
	// In plain text mode we can't show the interactive auth flow
	const hasAuth = await isAuthConfigured()
	if (!hasAuth) {
		printWarning("Not authenticated. Please run 'dirac auth' first to configure your API credentials.")
		await disposeCliContext(ctx)
		await drainOutput()
		exit(1)
	}

	const reason = await getPlainTextModeReason(options)
	telemetryService.captureHostEvent("plain_text_mode", reason)

	// Plain text mode: no Ink rendering, just clean text output
	const success = await runPlainTextTask({
		controller: ctx.controller,
		yolo: options.yolo || options.autoApproveAll,
		prompt: taskConfig.prompt,
		taskId: taskConfig.taskId,
		imageDataUrls: taskConfig.imageDataUrls,
		verbose: options.verbose,
		jsonOutput: options.json,
		timeoutSeconds: taskConfig.timeoutSeconds,
	})

	// Cleanup
	await disposeCliContext(ctx)

	// Ensure result and diagnostic streams are fully drained before exiting.
	await drainOutput()
	exit(success ? 0 : 1)
}

/**
 * Run a task with the given prompt through the shared interactive or standalone startup path.
 */
export async function runTask(prompt: string, options: TaskOptions, existingContext?: CliContext) {
	const path = await import("node:path")
	const { parseImagesFromInput, processImagePaths } = await import("../utils/parser")
	const { telemetryService } = await import("@/services/telemetry")
	const { StateManager } = await import("@/core/storage/StateManager")
	const { checkRawModeSupport } = await import("../context/StdinContext")
	const { parseTimeoutSeconds } = await import("../utils/task-timeout")

	const timeoutSeconds = parseTimeoutSeconds(options.timeout)
	const workspacePath = path.resolve(existingContext?.workspacePath || options.cwd || process.cwd())

	// Parse images from the prompt text (e.g., @/path/to/image.png)
	const { prompt: cleanPrompt, imagePaths: parsedImagePaths } = parseImagesFromInput(prompt, workspacePath)

	// Combine parsed image paths with explicit --images option
	const allImagePaths = [...(options.images || []), ...parsedImagePaths]
	// Convert image file paths to base64 data URLs
	const imageDataUrls = await processImagePaths(allImagePaths, workspacePath)

	// Use clean prompt (with image refs removed)
	const taskPrompt = cleanPrompt

	const ctx = existingContext || (await initializeCli({ ...options, enableAuth: true }))
	const React = (await import("react")).default
	const { App } = await import("../components/App")

	// Task without prompt starts in interactive mode
	telemetryService.captureHostEvent("task_command", prompt ? "task" : "interactive")

	// Capture piped stdin telemetry now that HostProvider is initialized
	if (options.stdinWasPiped) {
		telemetryService.captureHostEvent("piped", "detached")
	}

	// Apply shared task options (mode, model, thinking, yolo)
	await applyTaskOptions(options, workspacePath, ctx.controller)
	await StateManager.get().flushPendingState()

	// Use plain text mode when output is redirected, stdin was piped, JSON mode is enabled, or --yolo flag is used
	if (await shouldUsePlainTextMode(options)) {
		return runTaskInPlainTextMode(ctx, options, {
			prompt: taskPrompt,
			imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			timeoutSeconds,
		})
	}

	// Interactive mode: render the application with an optional initial prompt/images.
	ctx.controller.enableInteractiveGoals()
	// If prompt provided (dirac task "prompt"), ChatView will auto-submit
	// If no prompt (dirac interactive), user will type it in
	let taskError = false

	await runInkApp(
		React.createElement(App, {
			view: "welcome",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			initialPrompt: taskPrompt || undefined,
			initialImages: imageDataUrls.length > 0 ? imageDataUrls : undefined,
			timeoutSeconds,
			onError: () => {
				taskError = true
			},
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
		}),
		createInkCleanup(ctx, () => taskError),
	)
}

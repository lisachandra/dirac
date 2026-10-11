import { exit } from "node:process"
import type { TaskOptions } from "../types"
import { initializeCli } from "../init"
import { disposeCliContext } from "../utils/cleanup"
import { applyTaskOptions } from "../utils/options"
import { runInkApp } from "../utils/ink"

/**
 * Show welcome prompt and wait for user input
 * If auth is not configured, show auth flow first
 */
export async function showWelcome(options: TaskOptions) {
	const { isAuthConfigured } = await import("../utils/auth")
	const { StateManager } = await import("@/core/storage/StateManager")
	const { checkRawModeSupport } = await import("../context/StdinContext")

	const ctx = await initializeCli({ ...options, enableAuth: true })
	const React = (await import("react")).default
	const { App } = await import("../components/App")

	// Check if auth is configured
	const hasAuth = await isAuthConfigured()

	// Apply CLI task options in interactive startup too, so flags like
	// --auto-approve-all and --yolo affect the initial TUI state.
	await applyTaskOptions(options, ctx.workspacePath, ctx.controller)
	await StateManager.get().flushPendingState()

	let hadError = false

	ctx.controller.enableInteractiveGoals()
	await runInkApp(
		React.createElement(App, {
			// Start with auth view if not configured, otherwise welcome
			view: hasAuth ? "welcome" : "auth",
			verbose: options.verbose,
			controller: ctx.controller,
			isRawModeSupported: checkRawModeSupport(),
			onWelcomeExit: () => {
				// User pressed Esc; Ink exits and cleanup handles process exit.
			},
			onError: () => {
				hadError = true
			},
		}),
		async () => {
			await disposeCliContext(ctx)
			exit(hadError ? 1 : 0)
		},
	)
}

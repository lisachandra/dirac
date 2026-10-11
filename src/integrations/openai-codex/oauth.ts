import type { OpenAiCodexAuthInstructions, OpenAiCodexAuthMethod } from "@shared/openai-codex-auth"
import { OAuthFlowHandler } from "./OAuthFlowHandler"
import { OAuthTokenManager } from "./OAuthTokenManager"
import type { OpenAiCodexCredentials, OpenAiCodexDeviceAuthorization } from "./oauth-shared"

// Re-export the public API surface so existing imports keep working.
export {
	buildAuthorizationUrl,
	exchangeCodeForTokens,
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
	isTokenExpired,
	OPENAI_CODEX_OAUTH_CONFIG,
	type OpenAiCodexCredentials,
	type OpenAiCodexDeviceAuthorization,
	refreshAccessToken,
} from "./oauth-shared"

/** Token storage plus isolated interactive sign-in attempts and the legacy browser-flow API. */

export class OpenAiCodexOAuthManager {
	private readonly tokenManager: OAuthTokenManager
	private readonly flowHandler: OAuthFlowHandler

	constructor() {
		this.tokenManager = new OAuthTokenManager()
		this.flowHandler = new OAuthFlowHandler(this.tokenManager)
	}

	/** An isolated, cancellable attempt shared by the CLI and extension. Never opens a browser. */
	async authenticate(
		method: OpenAiCodexAuthMethod,
		onReady: (instructions: OpenAiCodexAuthInstructions) => void | Promise<void>,
		signal: AbortSignal,
	): Promise<void> {
		signal.throwIfAborted()
		const flow = new OAuthFlowHandler(this.tokenManager)
		const cancel = () => flow.cancelAuthorizationFlow()
		signal.addEventListener("abort", cancel, { once: true })
		try {
			if (method === "device") {
				const data = await flow.initiateDeviceFlow(signal)
				signal.throwIfAborted()
				await onReady({ url: data.verification_uri, userCode: data.user_code })
				await flow.pollForDeviceToken(data.device_code, data.user_code, data.interval ?? 5, signal)
				return
			}
			const url = flow.startAuthorizationFlow()
			// Attach both branches immediately so listener failures cannot become unhandled rejections.
			await Promise.all([flow.waitForCallback(), Promise.resolve().then(() => onReady({ url }))])
		} finally {
			signal.removeEventListener("abort", cancel)
			cancel()
		}
	}

	async forceRefreshAccessToken(): Promise<string | null> {
		return this.tokenManager.forceRefreshAccessToken()
	}

	async loadCredentials(): Promise<OpenAiCodexCredentials | null> {
		return this.tokenManager.loadCredentials()
	}

	async saveCredentials(credentials: OpenAiCodexCredentials): Promise<void> {
		return this.tokenManager.saveCredentials(credentials)
	}

	async clearCredentials(): Promise<void> {
		return this.tokenManager.clearCredentials()
	}

	async getAccessToken(): Promise<string | null> {
		return this.tokenManager.getAccessToken()
	}

	async getEmail(): Promise<string | null> {
		return this.tokenManager.getEmail()
	}

	async getAccountId(): Promise<string | null> {
		return this.tokenManager.getAccountId()
	}

	async isAuthenticated(): Promise<boolean> {
		return this.tokenManager.isAuthenticated()
	}

	async initiateDeviceFlow(signal?: AbortSignal): Promise<OpenAiCodexDeviceAuthorization> {
		return this.flowHandler.initiateDeviceFlow(signal)
	}

	async pollForDeviceToken(
		deviceCode: string,
		userCode: string,
		interval: number,
		signal?: AbortSignal,
		expiresInMs?: number,
	): Promise<OpenAiCodexCredentials> {
		return this.flowHandler.pollForDeviceToken(deviceCode, userCode, interval, signal, expiresInMs)
	}

	startAuthorizationFlow(): string {
		return this.flowHandler.startAuthorizationFlow()
	}

	async waitForCallback(): Promise<OpenAiCodexCredentials> {
		return this.flowHandler.waitForCallback()
	}

	cancelAuthorizationFlow(): void {
		this.flowHandler.cancelAuthorizationFlow()
	}

	getCredentials(): OpenAiCodexCredentials | null {
		return this.tokenManager.getCredentials()
	}
}

// Singleton instance
export const openAiCodexOAuthManager = new OpenAiCodexOAuthManager()

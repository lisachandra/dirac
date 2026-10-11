import { jsonHeaders } from "@shared/net"
import * as http from "http"
import { URL } from "url"
import { fetch, isAuthError } from "@/shared/net"
import type { OAuthTokenManager } from "./OAuthTokenManager"
import {
	buildAuthorizationUrl,
	buildDeviceAuthUnavailableError,
	deviceAuthorizationResponseSchema,
	deviceTokenResponseSchema,
	exchangeCodeForTokensWithRedirectUri,
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
	OPENAI_CODEX_OAUTH_CONFIG,
	type OpenAiCodexCredentials,
	type OpenAiCodexDeviceAuthorization,
	parseOAuthErrorDetails,
	waitForDevicePollInterval,
} from "./oauth-shared"

/**
 * OAuthFlowHandler - Owns the authorization code flow (both device-code and
 * browser callback variants). Persists resulting credentials via OAuthTokenManager.
 */
export class OAuthFlowHandler {
	private pendingAuth: {
		codeVerifier: string
		state: string
		abortController: AbortController
		server?: http.Server
	} | null = null

	constructor(private readonly tokenManager: OAuthTokenManager) {}

	/**
	 * Initiate OAuth device-code authentication for remote/headless CLI environments.
	 */
	async initiateDeviceFlow(signal?: AbortSignal): Promise<OpenAiCodexDeviceAuthorization> {
		const body = JSON.stringify({
			client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
		})

		const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.deviceAuthorizationEndpoint, {
			method: "POST",
			headers: {
				...jsonHeaders(),
			},
			body,
			signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
		})

		if (!response.ok) {
			const errorText = await response.text()
			const { errorCode, errorMessage } = parseOAuthErrorDetails(errorText)
			if (
				response.status === 404 ||
				/unsupported|disabled|not[_ -]?enabled/i.test(`${errorCode ?? ""} ${errorMessage ?? ""}`)
			) {
				throw buildDeviceAuthUnavailableError()
			}
			const details = errorMessage ? errorMessage : errorText
			throw new Error(
				`Device authorization failed: ${response.status} ${response.statusText}${details ? ` - ${details}` : ""}`,
			)
		}

		const data = await response.json()
		const parsed = deviceAuthorizationResponseSchema.parse(data)
		return {
			device_code: parsed.device_auth_id,
			user_code: parsed.user_code,
			verification_uri: "https://auth.openai.com/codex/device",
			interval: parsed.interval,
		}
	}

	/**
	 * Poll the token endpoint until the user completes device-code authentication.
	 */
	async pollForDeviceToken(
		deviceCode: string,
		userCode: string,
		interval: number,
		signal?: AbortSignal,
		expiresInMs: number = 15 * 60 * 1000,
	): Promise<OpenAiCodexCredentials> {
		let currentInterval = Math.max(interval, 0.1)
		const expiresAt = Date.now() + expiresInMs

		while (true) {
			if (signal?.aborted) {
				throw new Error("Device authentication was cancelled.")
			}
			if (Date.now() >= expiresAt) throw new Error("The device code has expired. Please try again.")

			const body = JSON.stringify({
				device_auth_id: deviceCode,
				user_code: userCode,
			})

			const fetchSignal = AbortSignal.any([
				AbortSignal.timeout(Math.max(1, Math.min(30000, expiresAt - Date.now()))),
				...(signal ? [signal] : []),
			])
			const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.deviceTokenEndpoint, {
				method: "POST",
				headers: {
					...jsonHeaders(),
				},
				body,
				signal: fetchSignal,
			})

			const responseText = await response.text()
			let data: unknown
			try {
				data = responseText ? JSON.parse(responseText) : {}
			} catch {
				throw new Error(`Device token polling failed: ${response.status} ${response.statusText} - ${responseText}`)
			}

			const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
			const error = typeof obj.error === "string" ? obj.error : undefined
			const errorDescription = typeof obj.error_description === "string" ? obj.error_description : undefined

			if (response.ok && !error) {
				const deviceTokenResponse = deviceTokenResponseSchema.parse(data)
				const credentials = await exchangeCodeForTokensWithRedirectUri(
					deviceTokenResponse.authorization_code,
					deviceTokenResponse.code_verifier,
					OPENAI_CODEX_OAUTH_CONFIG.deviceRedirectUri,
					fetchSignal,
				)
				fetchSignal.throwIfAborted()
				await this.tokenManager.saveCredentials(credentials)
				return credentials
			}

			if (error === "slow_down") {
				currentInterval += 5
				await waitForDevicePollInterval(Math.min(currentInterval, (expiresAt - Date.now()) / 1000), signal)
				continue
			}

			if (error === "expired_token") {
				throw new Error("The device code has expired. Please try again.")
			}

			if (error === "access_denied") {
				throw new Error("Access denied by user.")
			}

			if (error === "authorization_pending") {
				await waitForDevicePollInterval(Math.min(currentInterval, (expiresAt - Date.now()) / 1000), signal)
				continue
			}

			if (/unsupported|disabled|not[_ -]?enabled/i.test(`${error ?? ""} ${errorDescription ?? ""}`)) {
				throw buildDeviceAuthUnavailableError()
			}

			if (!error && (isAuthError(response.status) || response.status === 404)) {
				await waitForDevicePollInterval(Math.min(currentInterval, (expiresAt - Date.now()) / 1000), signal)
				continue
			}

			throw new Error(`OAuth error: ${errorDescription || error || responseText}`)
		}
	}

	/**
	 * Start the OAuth authorization flow
	 * Returns the authorization URL to open in browser
	 */
	startAuthorizationFlow(): string {
		// Cancel any existing authorization flow before starting a new one
		this.cancelAuthorizationFlow()

		const codeVerifier = generateCodeVerifier()
		const codeChallenge = generateCodeChallenge(codeVerifier)
		const state = generateState()

		this.pendingAuth = {
			codeVerifier,
			state,
			abortController: new AbortController(),
		}

		return buildAuthorizationUrl(codeChallenge, state)
	}

	/** Listen for the browser callback; cancellation settles the pending promise. */
	async waitForCallback(): Promise<OpenAiCodexCredentials> {
		const pending = this.pendingAuth
		if (!pending) throw new Error("No pending authorization flow")
		if (pending.server) throw new Error("Already waiting for browser sign-in")
		const signal = pending.abortController.signal

		return new Promise((resolve, reject) => {
			let settled = false
			let exchanging = false
			const finish = (error?: Error, credentials?: OpenAiCodexCredentials) => {
				if (settled) return
				settled = true
				clearTimeout(timeout)
				signal.removeEventListener("abort", onAbort)
				pending.abortController.abort()
				server.close()
				if (this.pendingAuth === pending) this.pendingAuth = null
				if (error) reject(error)
				else resolve(credentials!)
			}
			const onAbort = () => finish(new Error("Browser authentication was cancelled."))
			const server = http.createServer(async (req, res) => {
				try {
					const url = new URL(req.url || "", OPENAI_CODEX_OAUTH_CONFIG.redirectUri)
					if (url.pathname !== "/auth/callback") {
						res.writeHead(404).end("Not Found")
						return
					}
					if (settled || exchanging) {
						res.writeHead(409).end("Sign-in is already being completed.")
						return
					}
					exchanging = true
					const code = url.searchParams.get("code")
					if (url.searchParams.get("state") !== pending.state) throw new Error("State mismatch")
					const error = url.searchParams.get("error")
					if (error) throw new Error(`OAuth error: ${error}`)
					if (!code) throw new Error("Missing authorization code")
					const credentials = await exchangeCodeForTokensWithRedirectUri(
						code,
						pending.codeVerifier,
						OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
						signal,
					)
					signal.throwIfAborted()
					await this.tokenManager.saveCredentials(credentials)
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
					res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authentication Successful</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
  }
  .container { text-align: center; padding: 48px; max-width: 420px; }
  .icon {
    width: 72px; height: 72px; margin: 0 auto 24px;
    background: linear-gradient(135deg, #10a37f 0%, #1a7f64 100%);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }
  .icon svg { width: 36px; height: 36px; stroke: #fff; stroke-width: 3; fill: none; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
  p { font-size: 15px; color: rgba(255,255,255,0.7); line-height: 1.5; }
  .closing { margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.5); }
</style>
</head>
<body>
<div class="container">
  <div class="icon">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </div>
  <h1>Authentication Successful</h1>
  <p>You're now signed in to OpenAI Codex. You can close this window and return to your IDE.</p>
  <p class="closing">This window will close automatically...</p>
</div>
<script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`)
					finish(undefined, credentials)
				} catch (error) {
					res.writeHead(400).end("Authentication failed. Return to Dirac to retry.")
					finish(error instanceof Error ? error : new Error(String(error)))
				}
			})
			const timeout = setTimeout(
				() => {
					finish(new Error("Authentication timed out"))
				},
				5 * 60 * 1000,
			)
			server.on("error", (error: NodeJS.ErrnoException) => {
				finish(
					error.code === "EADDRINUSE"
						? new Error(
								`Port ${OPENAI_CODEX_OAUTH_CONFIG.callbackPort} is already in use. Close the other sign-in attempt or use device code.`,
							)
						: error,
				)
			})
			pending.server = server
			signal.addEventListener("abort", onAbort, { once: true })
			server.listen(OPENAI_CODEX_OAUTH_CONFIG.callbackPort, "127.0.0.1")
		})
	}

	/** Cancel only the currently pending browser authorization. */
	cancelAuthorizationFlow(): void {
		this.pendingAuth?.abortController.abort()
		this.pendingAuth = null
	}
}

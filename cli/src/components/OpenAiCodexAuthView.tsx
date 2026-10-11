import type { OpenAiCodexAuthInstructions, OpenAiCodexAuthMethod } from "@shared/openai-codex-auth"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"
import React, { useEffect, useRef, useState } from "react"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openAiCodexUsageService } from "@/integrations/openai-codex/OpenAiCodexUsageService"
import { openExternal } from "@/utils/env"
import { theme } from "../constants/theme"
import { useStdinContext } from "../context/StdinContext"
import { copyToClipboardNative } from "../utils/clipboard"

interface OpenAiCodexAuthViewProps {
	onComplete: () => void | Promise<void>
	onCancel: () => void
	initialMethod?: OpenAiCodexAuthMethod
}

/** Shared interactive sign-in for onboarding and settings. Browser launching is always explicit. */
export const OpenAiCodexAuthView: React.FC<OpenAiCodexAuthViewProps> = ({ onComplete, onCancel, initialMethod }) => {
	const { isRawModeSupported } = useStdinContext()
	const [method, setMethod] = useState<OpenAiCodexAuthMethod | undefined>(initialMethod)
	const [selectedMethod, setSelectedMethod] = useState<OpenAiCodexAuthMethod>("browser")
	const [instructions, setInstructions] = useState<OpenAiCodexAuthInstructions>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const [attempt, setAttempt] = useState(0)
	const abortRef = useRef<AbortController | null>(null)
	const completeRef = useRef(onComplete)
	completeRef.current = onComplete

	useEffect(() => {
		if (!method) return
		const abort = new AbortController()
		abortRef.current = abort
		setInstructions(undefined)
		setError(undefined)
		setNotice(undefined)
		void (async () => {
			try {
				await openAiCodexOAuthManager.authenticate(
					method,
					(data) => {
						if (!abort.signal.aborted) setInstructions(data)
					},
					abort.signal,
				)
				if (abort.signal.aborted) return
				openAiCodexUsageService.clear()
				await completeRef.current()
			} catch (failure) {
				if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
			}
		})()
		return () => abort.abort()
	}, [method, attempt])

	useInput(
		(input, key) => {
			if (key.escape) {
				abortRef.current?.abort()
				onCancel()
				return
			}
			if (!method) {
				if (key.upArrow || key.downArrow) setSelectedMethod((current) => (current === "browser" ? "device" : "browser"))
				if (key.return) setMethod(selectedMethod)
				if (input === "b") setMethod("browser")
				if (input === "d") setMethod("device")
				return
			}
			if (error) {
				if (input === "r") setAttempt((current) => current + 1)
				if (input === "b" || input === "d") {
					setMethod(input === "b" ? "browser" : "device")
					setAttempt((current) => current + 1)
				}
				return
			}
			if (!instructions) return
			if (input === "c" || input === "l") {
				const value = input === "l" ? instructions.url : (instructions.userCode ?? instructions.url)
				setNotice(
					copyToClipboardNative(value) ? "Copied to clipboard." : "Could not copy; select the text above manually.",
				)
			}
			if (input === "o") {
				const signal = abortRef.current!.signal
				void openExternal(instructions.url).catch((failure) => {
					if (!signal.aborted) setNotice(`Could not open browser: ${String(failure)}. Copy the link instead.`)
				})
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color={theme.text}>
				Sign in with ChatGPT
			</Text>
			{!method ? (
				<React.Fragment>
					<Text color={selectedMethod === "browser" ? theme.info : theme.text}>
						{selectedMethod === "browser" ? "❯" : " "} Browser link
					</Text>
					<Text color={selectedMethod === "device" ? theme.info : theme.text}>
						{selectedMethod === "device" ? "❯" : " "} Device code (also works on remote machines)
					</Text>
					<Text color={theme.muted}>Arrows and Enter to choose · b browser · d device code · Esc back</Text>
				</React.Fragment>
			) : error ? (
				<React.Fragment>
					<Text color={theme.error}>{error}</Text>
					<Text color={theme.muted}>r retry · b browser link · d device code · Esc back</Text>
				</React.Fragment>
			) : (
				<React.Fragment>
					<Text color={theme.text}>
						<Spinner type="dots" /> {instructions ? "Waiting for ChatGPT sign-in…" : "Preparing sign-in…"}
					</Text>
					{instructions && (
						<React.Fragment>
							<Text color={theme.text}>
								{instructions.userCode
									? "Open this page and enter the code:"
									: "Open this link in your preferred browser:"}
							</Text>
							<Text color={theme.info} wrap="wrap">
								{instructions.url}
							</Text>
							{instructions.userCode && (
								<Text bold color={theme.warning}>
									{instructions.userCode}
								</Text>
							)}
							<Text color={theme.muted}>
								{instructions.userCode ? "c copy code · l copy link" : "c copy link"} · o open browser
							</Text>
							{!instructions.userCode && (
								<Text color={theme.muted}>Remote machine? Use device code or forward localhost port 1455.</Text>
							)}
						</React.Fragment>
					)}
					{notice && <Text color={theme.warning}>{notice}</Text>}
					<Text color={theme.muted}>Esc to cancel</Text>
				</React.Fragment>
			)}
		</Box>
	)
}

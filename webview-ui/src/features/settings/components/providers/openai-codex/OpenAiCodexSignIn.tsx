import { StringRequest } from "@shared/proto/dirac/common"
import { OpenAiCodexAuthMethod, OpenAiCodexAuthRequest, type OpenAiCodexAuthEvent } from "@shared/proto/dirac/models"
import { useEffect, useRef, useState } from "react"
import { FileServiceClient, ModelsServiceClient, UiServiceClient } from "@/shared/api/grpc-client"
import { Button } from "@/shared/ui/button"

export function OpenAiCodexSignIn() {
	const [method, setMethod] = useState<OpenAiCodexAuthMethod>()
	const [instructions, setInstructions] = useState<OpenAiCodexAuthEvent>()
	const [error, setError] = useState<string>()
	const [notice, setNotice] = useState<string>()
	const cancelRef = useRef<(() => void) | undefined>(undefined)
	const generation = useRef(0)

	const cancel = () => {
		generation.current++
		cancelRef.current?.()
		cancelRef.current = undefined
		setMethod(undefined)
		setInstructions(undefined)
		setNotice(undefined)
	}

	useEffect(
		() => () => {
			generation.current++
			cancelRef.current?.()
		},
		[],
	)

	const start = (selected: OpenAiCodexAuthMethod) => {
		cancel()
		setMethod(selected)
		setError(undefined)
		const attempt = generation.current
		cancelRef.current = ModelsServiceClient.authenticateOpenAiCodex(OpenAiCodexAuthRequest.create({ method: selected }), {
			onResponse: (event) => {
				if (attempt !== generation.current) return
				if (!event.completed) setInstructions(event)
			},
			onError: (failure) => {
				if (attempt !== generation.current) return
				cancel()
				setError(failure.message)
			},
			onComplete: () => {
				if (attempt === generation.current) cancel()
			},
		})
	}

	const copy = async (value: string, label: string) => {
		try {
			await FileServiceClient.copyToClipboard(StringRequest.create({ value }))
			setNotice(`${label} copied`)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Could not copy to clipboard")
		}
	}
	const open = async (url: string) => {
		try {
			await UiServiceClient.openUrl(StringRequest.create({ value: url }))
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Could not open browser; copy the link instead")
		}
	}

	return (
		<div className="space-y-2">
			{method === undefined ? (
				<div className="flex flex-wrap gap-2">
					<Button
						onClick={() => start(OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_BROWSER)}
						size="sm"
						type="button">
						Browser link
					</Button>
					<Button
						onClick={() => start(OpenAiCodexAuthMethod.OPEN_AI_CODEX_AUTH_METHOD_DEVICE)}
						size="sm"
						type="button"
						variant="outline">
						Device code
					</Button>
				</div>
			) : (
				<>
					<p aria-live="polite" className="text-xs">
						{instructions ? "Waiting for ChatGPT sign-in…" : "Preparing sign-in…"}
					</p>
					{instructions && (
						<>
							{instructions.userCode && (
								<div className="space-y-2">
									<p className="text-xs">Open the verification page and enter this code:</p>
									<code className="select-all text-base">{instructions.userCode}</code>
									<Button
										onClick={() => void copy(instructions.userCode!, "Code")}
										size="sm"
										type="button"
										variant="outline">
										Copy code
									</Button>
								</div>
							)}
							<input
								aria-label="ChatGPT sign-in link"
								className="w-full text-xs"
								readOnly
								value={instructions.url}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									onClick={() => void copy(instructions.url, "Link")}
									size="sm"
									type="button"
									variant="outline">
									Copy link
								</Button>
								<Button onClick={() => void open(instructions.url)} size="sm" type="button">
									{instructions.userCode ? "Open verification page" : "Open browser"}
								</Button>
							</div>
							{!instructions.userCode && (
								<p className="text-xs">
									Open this link in your preferred browser. For remote machines, use device code or forward
									localhost port 1455.
								</p>
							)}
						</>
					)}
					<Button onClick={cancel} size="sm" type="button" variant="ghost">
						Cancel
					</Button>
				</>
			)}
			{notice && (
				<p className="text-xs" role="status">
					{notice}
				</p>
			)}
			{error && (
				<p className="text-xs" role="alert">
					{error} {method === undefined && "Choose a sign-in method to retry."}
				</p>
			)}
		</div>
	)
}

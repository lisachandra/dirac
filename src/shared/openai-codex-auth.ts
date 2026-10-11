/** Public sign-in instructions. OAuth tokens and device polling identifiers stay in the backend. */
export type OpenAiCodexAuthMethod = "browser" | "device"

export interface OpenAiCodexAuthInstructions {
	url: string
	userCode?: string
}

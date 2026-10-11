/**
 * github-url-utils.ts
 *
 * Portable utility functions for creating and opening GitHub issue URLs
 * with proper URL encoding.
 *
 * URLs are opened through the host's external opener with the URL passed as a
 * single value — never through a shell — so no command parsing or injection
 * is possible. Only http(s) schemes are accepted.
 */

import { HostProvider } from "@hosts/host-provider"
import { ShowMessageType } from "@shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { openExternal, writeTextToClipboard } from "@/utils/env"

const ALLOWED_URL_SCHEMES = ["https:", "http:"]

function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return ALLOWED_URL_SCHEMES.includes(parsed.protocol)
	} catch {
		return false
	}
}

/**
 * Creates a properly encoded GitHub issue URL.
 *
 * This function manually encodes each parameter value using encodeURIComponent()
 * to ensure consistent and correct encoding of all special characters. This is
 * necessary because VS Code's URI handling (vscode.Uri.parse) has issues with
 * encoding/decoding URL parameters, as documented in:
 * https://github.com/microsoft/vscode/issues/85930
 *
 * Specifically, VS Code's URI handling:
 * - Double-encodes some characters like # (hash) becoming %2523 instead of %23
 * - Inconsistently handles other characters like & (ampersand) and + (plus)
 * - Can corrupt query parameters containing special characters
 *
 * @param baseUrl The base GitHub repository URL (e.g., 'https://github.com/owner/repo/issues/new')
 * @param params Map of parameter names to values for the issue form
 * @returns The properly encoded full URL
 */
export function createGitHubIssueUrl(baseUrl: string, params: Map<string, string>): string {
	// Build query string manually with proper encoding
	const queryParts: string[] = []

	for (const [key, value] of params.entries()) {
		const encodedKey = encodeURIComponent(key)
		const encodedValue = encodeURIComponent(value)
		queryParts.push(`${encodedKey}=${encodedValue}`)
	}

	// Determine the proper separator (? or &) based on whether baseUrl already has parameters
	const separator = baseUrl.includes("?") ? "&" : "?"

	// Join all parts to create the final URL
	const queryString = queryParts.join("&")
	return `${baseUrl}${separator}${queryString}`
}

/**
 * Opens a URL via the host's external opener, falling back to a clipboard notice.
 *
 * Only http(s) URLs are allowed; the URL is handed to the host opener as a single
 * value, never through a shell, so no command parsing or injection is possible.
 *
 * @param url The URL to open
 * @returns A promise that resolves when an attempt to open the URL has completed
 */
export async function openUrlInBrowser(url: string): Promise<void> {
	if (!isValidHttpUrl(url)) {
		throw new Error(`Blocked URL with disallowed scheme: ${url}`)
	}

	Logger.log(`Opening URL: ${url}`)

	// Always copy to clipboard as a fallback
	try {
		await writeTextToClipboard(url)
		Logger.log("URL copied to clipboard as backup")
	} catch (error) {
		Logger.error(`Failed to copy URL to clipboard: ${error}`)
	}

	try {
		await openExternal(url)
		Logger.log("Opened URL with openExternal")
	} catch (error) {
		Logger.error(`Error with openExternal utility: ${error}`)

		// Last fallback: Show a message with instructions
		HostProvider.window
			.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Couldn't open the URL automatically. It has been copied to your clipboard.",
				options: {
					items: ["Copy URL Again"],
				},
			})
			.then((response) => {
				if (response.selectedOption === "Copy URL Again") {
					writeTextToClipboard(url)
				}
			})
			.catch((error) => {
				Logger.error("Failed to show URL open fallback message:", error)
			})
	}
}

/**
 * Utility function to create and open a GitHub issue with the specified parameters.
 *
 * This is a high-level function that combines URL creation and opening. It provides
 * a simple API for the common use case of opening GitHub issue templates with
 * pre-filled fields.
 *
 * The function:
 * 1. Constructs a correctly formatted GitHub issue URL
 * 2. Properly encodes all special characters in parameters
 * 3. Opens the URL via the host's external opener
 * 4. Falls back to a clipboard notice if opening fails
 *
 * @param repoOwner GitHub repository owner/organization
 * @param repoName GitHub repository name
 * @param issueTemplate Template name to use (e.g., 'bug_report.yml')
 * @param params Map of parameter names to values for the issue form
 */
export async function createAndOpenGitHubIssue(
	repoOwner: string,
	repoName: string,
	issueTemplate: string | null,
	params: Map<string, string>,
): Promise<void> {
	// Construct the base URL
	const baseUrl = `https://github.com/${repoOwner}/${repoName}/issues/new`

	// Add template parameter if provided
	if (issueTemplate) {
		params.set("template", issueTemplate)
	}

	// Create the URL and open it
	const issueUrl = createGitHubIssueUrl(baseUrl, params)
	await openUrlInBrowser(issueUrl)
}

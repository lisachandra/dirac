import { parseDiracIgnoreContent } from "@/shared/ignore/DiracIgnorePolicy"

/**
 * Parses .diracignore content, resolving "!include <file>" directives by inlining
 * the referenced files' contents. Returns the combined ignore-pattern text ready
 * to be fed to an `ignore` instance.
 */
export async function parseIgnoreContent(content: string, cwd: string): Promise<string> {
	return (await parseDiracIgnoreContent(content, cwd)).content
}

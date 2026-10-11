import { Logger } from "@shared/services/Logger"
import fs from "fs/promises"
import * as path from "path"

export interface TaskPromptArtifactsContext {
	taskId: string
	cwd: string
	writePromptMetadataEnabled: boolean
	writePromptMetadataDirectory?: string
}

export async function writePromptMetadataArtifacts(
	ctx: TaskPromptArtifactsContext,
	params: {
		systemPrompt: string
		providerInfo: { providerId?: string; modelId?: string }
		tools?: any[]
		fullHistory?: any[]
		deletedRange?: [number, number]
	},
): Promise<void> {
	const enabledSetting = ctx.writePromptMetadataEnabled
	const enabledFlag = process.env.DIRAC_WRITE_PROMPT_ARTIFACTS?.toLowerCase()
	const enabled =
		enabledSetting || enabledFlag === "1" || enabledFlag === "true" || enabledFlag === "yes" || process.env.IS_DEV === "true"
	if (!enabled) {
		return
	}

	try {
		// Env var is OS-level (user-controlled, safe to allow absolute); workspace setting is the exfiltration vector.
		const envDir = process.env.DIRAC_PROMPT_ARTIFACT_DIR?.trim()
		const settingDir = ctx.writePromptMetadataDirectory?.trim()
		const cwdResolved = path.resolve(ctx.cwd)
		// Setting-configured dirs must resolve under cwd to prevent workspace settings from exfiltrating prompts.
		// Only validate the setting when no env var is provided — env takes precedence and is trusted.
		if (!envDir && settingDir) {
			const resolved = path.isAbsolute(settingDir) ? path.resolve(settingDir) : path.resolve(ctx.cwd, settingDir)
			if (resolved !== cwdResolved && !resolved.startsWith(cwdResolved + path.sep)) {
				Logger.warn(`[Task ${ctx.taskId}] writePromptMetadataDirectory outside cwd rejected: ${resolved}`)
				return
			}
		}
		const configuredDir = envDir || settingDir
		const artifactDir = configuredDir
			? path.isAbsolute(configuredDir)
				? path.resolve(configuredDir)
				: path.resolve(ctx.cwd, configuredDir)
			: path.resolve(ctx.cwd, ".dirac-prompt-artifacts")

		await fs.mkdir(artifactDir, { recursive: true })
		// Defense-in-depth: re-check the boundary after mkdir resolves any symlinks in the path,
		// so a workspace-planted symlink can't exfiltrate prompts outside cwd.
		// Only enforced for setting-derived paths — env vars are OS-level and may legitimately point anywhere.
		let writeDir = artifactDir
		if (!envDir) {
			const realArtifactDir = await fs.realpath(artifactDir)
			if (realArtifactDir !== cwdResolved && !realArtifactDir.startsWith(cwdResolved + path.sep)) {
				Logger.warn(`[Task ${ctx.taskId}] artifact dir resolves outside cwd (symlink?), rejected: ${realArtifactDir}`)
				return
			}
			writeDir = realArtifactDir
		}
		// Ensure the artifact dir is git-ignored so debug dumps don't get committed.
		const gitignorePath = path.join(writeDir, ".gitignore")
		await fs.writeFile(gitignorePath, "*\n!.gitignore\n", "utf8").catch(() => {})

		const debugPath = path.join(writeDir, `task-${ctx.taskId}-debug.md`)

		let markdown = `## System Prompt\n\n${params.systemPrompt}\n\n`

		if (params.tools) {
			markdown += `## Tools\n\n\`\`\`json\n${JSON.stringify(params.tools, null, 2)}\n\`\`\`\n\n`
		}

		if (params.fullHistory) {
			markdown += `## Conversation History\n\n`
			const [deletedStart, deletedEnd] = params.deletedRange || [-1, -1]

			for (let i = 0; i < params.fullHistory.length; i++) {
				const message = params.fullHistory[i]
				const isTruncated = i >= deletedStart && i <= deletedEnd

				markdown += `### [${message.role.toUpperCase()}]${isTruncated ? " [TRUNCATED]" : ""}\n`

				if (typeof message.content === "string") {
					markdown += `${message.content}\n\n`
				} else if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "text") {
							markdown += `**Text:** ${block.call_id ? `(\`call_id: ${block.call_id}\`)` : ""}\n${block.text}\n\n`
						} else if (block.type === "thinking") {
							markdown += `**Thinking:** ${block.call_id ? `(\`call_id: ${block.call_id}\`)` : ""}\n${block.thinking}\n\n`
						} else if (block.type === "redacted_thinking") {
							markdown += `**Thinking:** [Redacted] ${block.call_id ? `(\`call_id: ${block.call_id}\`)` : ""}\n\n`
						} else if (block.type === "tool_use") {
							markdown += `**Tool Use:** \`${block.name}\` (\`id: ${block.id}\`, \`call_id: ${block.call_id}\`)\n`
							markdown += `\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n\n`
						} else if (block.type === "tool_result") {
							markdown += `**Tool Result:** (\`${block.tool_use_id}\`)\n`
							if (typeof block.content === "string") {
								markdown += `${block.content}\n\n`
							} else if (Array.isArray(block.content)) {
								for (const contentBlock of block.content) {
									if (contentBlock.type === "text") {
										markdown += `${contentBlock.text}\n\n`
									} else if (contentBlock.type === "image") {
										markdown += `[Image: ${contentBlock.source?.type}]\n\n`
									}
								}
							}
						} else if (block.type === "image") {
							markdown += `[Image: ${block.source?.type}]\n\n`
						}
					}
				}
				markdown += "---\n\n"
			}
		}

		await fs.writeFile(debugPath, markdown, "utf8")
	} catch (error) {
		Logger.error("Failed to write prompt metadata artifacts:", error)
	}
}

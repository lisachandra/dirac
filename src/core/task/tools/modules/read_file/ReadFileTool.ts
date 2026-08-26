import * as path from "node:path"
import { formatResponse } from "@core/formatResponse"
import { contentHash, formatLinesForModel, getDelimiter } from "@utils/line-hashing"
import { CardStatus } from "@/shared/ExtensionMessage"
import { getErrorMessage } from "@/shared/errors"
import { DiracIcon } from "@/shared/icons"
import { DiracDefaultTool, DiracToolSpec } from "@/shared/tools"
import { IDiracTool } from "../../interfaces/IDiracTool"
import { IToolEnvironment } from "../../interfaces/IToolEnvironment"
import { SurfaceType } from "../../interfaces/SurfaceType"

export interface ReadFileArgs {
	paths: string[]
	start_line?: number
	end_line?: number
	include_anchors?: boolean
}

interface LineRange {
	start: number
	end?: number
}

interface TextSelection {
	text: string
	lines: string[]
	totalLineCount: number
	startIndex: number
	endIndex: number
	coversWholeFile: boolean
}

interface FullReadCacheRecord {
	contentHash: string
	anchorFingerprint?: string
}

const MAX_TEXT_READ_SIZE = 50 * 1024
const NON_EDITABLE_RICH_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"])

export const read_file_spec: DiracToolSpec = {
	id: DiracDefaultTool.FILE_READ,
	name: "read_file",
	description:
		"Reads complete files or selected line ranges, including extracted text from rich files such as PDF, DOCX, notebooks, and spreadsheets. Prefer inspect_ast when source structure or symbol identity matters. For editable text/source files, set include_anchors: true to read exact raw source lines as standalone coordinates required by edit_file. Extracted rich-file and image content is read-only and cannot provide edit_file coordinates.",
	parameters: [
		{
			name: "paths",
			required: true,
			type: "array",
			items: { type: "string" },
			instruction: "An array of relative paths to the source files.",
		},
		{
			name: "start_line",
			required: false,
			type: "integer",
			instruction: "Optional. If not supplied, output will start from line 1.",
		},
		{
			name: "end_line",
			required: false,
			type: "integer",
			instruction: "Optional. If not supplied, the output will go until the last line",
		},
		{
			name: "include_anchors",
			required: false,
			type: "boolean",
			instruction:
				`Optional. For editable text/source files, true reads the raw file and returns each selected source line as a standalone complete ANCHOR${getDelimiter()}CONTENT coordinate required by edit_file. Plain output, extracted rich-file text, and images cannot be used by edit_file. Default false.`,
		},
	],
}

export class ReadFileTool implements IDiracTool<ReadFileArgs> {
	spec(): DiracToolSpec {
		return read_file_spec
	}

	supportedSurfaces(): SurfaceType[] {
		return ["all"]
	}

	async processCall(args: ReadFileArgs, env: IToolEnvironment): Promise<any> {
		const paths = Array.isArray(args.paths) ? args.paths : args.paths ? [args.paths] : []

		if (paths.length === 0) {
			this.incrementMistakeCount(env)
			return formatResponse.toolError("Missing required parameter: paths")
		}

		const lineRange = this.parseLineRange(args.start_line, args.end_line)
		const results: string[] = []
		const contentBlocks: any[] = []
		const includeAnchors = args.include_anchors === true
		if (includeAnchors) await env.context.ensureAnchorState()
		const fileHashes = await env.context.task.get<Record<string, string | FullReadCacheRecord>>("fileHashes") || {}
		const cacheUpdates: Record<string, string | FullReadCacheRecord> = {}
		let anySucceeded = false

		for (const relPath of paths) {
			const { success, result, contentBlock } = await this.readFileContent(
				relPath,
				paths.length > 1,
				lineRange,
				fileHashes,
				cacheUpdates,
				env,
				includeAnchors,
			)
			anySucceeded ||= success
			results.push(result)
			if (contentBlock) {
				contentBlocks.push(contentBlock)
			}
		}

		this.updateTaskState(anySucceeded, env)
		if (Object.keys(cacheUpdates).length > 0) {
			await env.context.task.update<Record<string, string | FullReadCacheRecord>>("fileHashes", (current) => ({
				...current,
				...cacheUpdates,
			}))
		}

		const finalResultText = results.join("\n\n")
		if (contentBlocks.length > 0) {
			return [{ type: "text", text: finalResultText }, ...contentBlocks]
		}

		return finalResultText
	}

	private async readFileContent(
		relPath: string,
		isMultiFile: boolean,
		lineRange: LineRange | undefined,
		fileHashes: Record<string, string | FullReadCacheRecord>,
		cacheUpdates: Record<string, string | FullReadCacheRecord>,
		env: IToolEnvironment,
		includeAnchors: boolean,
	): Promise<{ success: boolean; result: string; contentBlock?: any }> {
		const header = isMultiFile ? `--- ${relPath} ---\n` : ""
		let absolutePath = ""
		let displayPath = relPath
		let usedWorkspaceHint = false
		let card: any | undefined

		try {
			const resolved = await env.workspace.resolvePath(relPath)
			absolutePath = resolved.absolutePath
			displayPath = resolved.displayPath
			usedWorkspaceHint = displayPath !== relPath

			const rangeLabel = lineRange ? `lines ${lineRange.start}-${lineRange.end ?? "end"}` : undefined
			card = !env.config.isSubagentExecution
				? await env.ui.createCard({
					header: rangeLabel ? `Reading ${rangeLabel} from ${displayPath}` : `Reading from ${displayPath}`,
					icon: DiracIcon.FILE_READ,
					collapsed: true,
					toolName: DiracDefaultTool.FILE_READ,
					rawInput: {
						path: displayPath,
						paths: [displayPath],
						...(lineRange ? { start_line: lineRange.start } : {}),
						...(lineRange?.end !== undefined ? { end_line: lineRange.end } : {}),
						...(includeAnchors ? { include_anchors: true } : {}),
					},
					locations: [{ path: displayPath }],
				})
				: undefined

			const extension = path.extname(absolutePath).toLowerCase()
			if (includeAnchors && NON_EDITABLE_RICH_EXTENSIONS.has(extension)) {
				throw new Error("Line anchors are unavailable for extracted rich-file or image content. Read the editable source file that will actually be changed.")
			}
			const fileContent = includeAnchors
				? { text: await env.workspace.readFile(absolutePath) }
				: await env.workspace.readRichFile(absolutePath)
			if (fileContent.imageBlock) {
				if (card) {
					await card.update({
						header: `Read image from ${displayPath}`,
						status: CardStatus.SUCCESS,
						body: `✓ Successfully read ${displayPath}`,
					})
					await card.finalize(CardStatus.SUCCESS)
				}
				this.captureReadTelemetry(relPath, usedWorkspaceHint, env)
				return { success: true, result: `${header}${fileContent.text}`, contentBlock: fileContent.imageBlock }
			}
			const selection = this.selectText(fileContent.text, lineRange)
			this.enforceTextReadSize(selection.text)

			const currentHash = contentHash(fileContent.text)
			const cacheKey = `${absolutePath}#${includeAnchors ? "anchored" : "plain"}`
			let anchors: string[] | undefined
			let anchorFingerprint: string | undefined
			if (includeAnchors) {
				const allLines = fileContent.text.split(/\r?\n/)
				anchors = env.anchors.reconcile(absolutePath, allLines)
				anchorFingerprint = env.anchors.getDocumentFingerprint(absolutePath) ?? undefined
			}

			const cachedRead = fileHashes[cacheKey]
			const contentMatches =
				typeof cachedRead === "string" ? cachedRead === currentHash : cachedRead?.contentHash === currentHash
			const anchorMappingMatches =
				!includeAnchors ||
				(anchorFingerprint !== undefined &&
					typeof cachedRead !== "string" &&
					cachedRead?.anchorFingerprint === anchorFingerprint)
			if (!includeAnchors && selection.coversWholeFile && contentMatches && anchorMappingMatches) {
				const result = `${header}no changes have been made to the file since your last read (Hash: ${currentHash})`
				if (card) {
					await card.update({
						header: `Reading from ${displayPath} (no changes)`,
						status: CardStatus.SUCCESS,
						body: "✓ No changes since last read",
					})
					await card.finalize(CardStatus.SUCCESS)
				}
				this.captureReadTelemetry(relPath, usedWorkspaceHint, env)
				return { success: true, result }
			}

			let formattedContent = selection.text
			if (anchors) {
				formattedContent = formatLinesForModel(
					selection.lines,
					anchors.slice(selection.startIndex, selection.endIndex),
					true,
				)
			}

			const lineCountSuffix = lineRange ? `\n[Total lines: ${selection.totalLineCount}]` : ""
			const result = `${header}[File Hash: ${currentHash}]${lineCountSuffix}\n${formattedContent}`

			if (card) {
				await card.update({
					header: rangeLabel ? `Read ${rangeLabel} from ${displayPath}` : `Read from ${displayPath}`,
					status: CardStatus.SUCCESS,
					body: `✓ Successfully read ${displayPath}${rangeLabel ? ` (${rangeLabel})` : ""}`,
				})
				await card.finalize(CardStatus.SUCCESS)
			}

			if (selection.coversWholeFile) {
				const cacheRecord = includeAnchors
					? { contentHash: currentHash, anchorFingerprint }
					: { contentHash: currentHash }
				fileHashes[cacheKey] = cacheRecord
				cacheUpdates[cacheKey] = cacheRecord
			}
			this.captureReadTelemetry(relPath, usedWorkspaceHint, env)
			return { success: true, result }
		} catch (error: any) {
			const errorMessage = getErrorMessage(error)
			const normalizedMessage = errorMessage.startsWith("Error reading file:")
				? errorMessage
				: `Error reading file: ${errorMessage}`

			if (card) {
				await card.update({ status: CardStatus.ERROR, body: `✕ ${normalizedMessage}` })
				await card.finalize(CardStatus.ERROR)
			}
			env.telemetry.captureCustomMetadata({
				path: relPath,
				isMultiRootEnabled: env.config.isMultiRootEnabled || false,
				usedWorkspaceHint,
				resolutionMethod: "error",
			})
			return { success: false, result: `${header}${normalizedMessage}` }
		}
	}
	private parseLineRange(startLine: number | undefined, endLine: number | undefined): LineRange | undefined {
		if (startLine === undefined && endLine === undefined) {
			return undefined
		}

		const parseLineNumber = (name: string, value: number | undefined): number | undefined => {
			if (value === undefined) {
				return undefined
			}
			const parsed = Number(value)
			if (!Number.isInteger(parsed) || parsed < 1) {
				throw new Error(`Invalid ${name}: must be an integer >= 1.`)
			}
			return parsed
		}

		const start = parseLineNumber("start_line", startLine) ?? 1
		const end = parseLineNumber("end_line", endLine)
		if (end !== undefined && start > end) {
			throw new Error(`Invalid line range: start_line ${start} cannot be greater than end_line ${end}.`)
		}
		return { start, end }
	}

	private selectText(text: string, lineRange: LineRange | undefined): TextSelection {
		const lines = text.split(/\r?\n/)
		if (!lineRange) {
			return {
				text,
				lines,
				totalLineCount: lines.length,
				startIndex: 0,
				endIndex: lines.length,
				coversWholeFile: true,
			}
		}

		if (lineRange.start > lines.length) {
			throw new Error(
				`start_line ${lineRange.start} exceeds file length (${lines.length} lines). No content in specified range.`,
			)
		}

		const startIndex = lineRange.start - 1
		const endIndex = Math.min(lineRange.end ?? lines.length, lines.length)
		const selectedLines = lines.slice(startIndex, endIndex)
		return {
			text: selectedLines.join("\n"),
			lines: selectedLines,
			totalLineCount: lines.length,
			startIndex,
			endIndex,
			coversWholeFile: startIndex === 0 && endIndex === lines.length,
		}
	}

	private enforceTextReadSize(text: string): void {
		const selectedBytes = Buffer.byteLength(text, "utf8")
		if (selectedBytes > MAX_TEXT_READ_SIZE) {
			throw new Error(
				`Selected text is ${selectedBytes} bytes, which exceeds the ${MAX_TEXT_READ_SIZE}-byte read limit. Specify a smaller line range.`,
			)
		}
	}

	private captureReadTelemetry(relPath: string, usedWorkspaceHint: boolean, env: IToolEnvironment): void {
		env.telemetry.captureCustomMetadata({
			path: relPath,
			isMultiRootEnabled: env.config.isMultiRootEnabled || false,
			usedWorkspaceHint,
			resolutionMethod: usedWorkspaceHint ? "hint" : "primary_fallback",
		})
	}

	private incrementMistakeCount(env: IToolEnvironment): void {
		env.orchestration.setTaskState("consecutiveMistakeCount", env.orchestration.getTaskState("consecutiveMistakeCount") + 1)
	}

	private updateTaskState(anySucceeded: boolean, env: IToolEnvironment): void {
		// Only reset on success. File-level failures are valid outcomes; missing
		// parameters are counted separately before file processing begins.
		if (anySucceeded) {
			env.orchestration.setTaskState("consecutiveMistakeCount", 0)
		}
	}
}

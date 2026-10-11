import { createReadStream } from "node:fs"
import * as path from "node:path"
import * as iconv from "iconv-lite"
import type { TextFileWindow, TextFileWindowOptions } from "@shared/text-file-window"
import { detectEncoding } from "./extract-text"


function assertTextSample(bytes: Buffer, encoding: string, extension: string): void {
	if (bytes.length === 0 || /^(utf-?16|ucs-?2)/i.test(encoding)) return
	let suspiciousControlBytes = 0
	for (const byte of bytes) {
		if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) suspiciousControlBytes++
	}
	if (suspiciousControlBytes <= bytes.length * 0.01) return
	throw new Error(`Cannot read binary content as text${extension ? ` for file type ${extension}` : ""}.`)
}


/** Streams a text file once, retaining only the requested window and optionally a bounded complete snapshot. */
export async function readTextFileWindow(filePath: string, options: TextFileWindowOptions): Promise<TextFileWindow> {
	const stream = createReadStream(filePath)
	let decoder: ReturnType<typeof iconv.getDecoder> | undefined
	let pendingBytes: Buffer[] = []
	let pendingByteCount = 0
	const completeChunks: string[] = []
	let retainedByteCount = 0
	let retainCompleteText = options.maxRetainedLines > 0 && options.maxRetainedBytes > 0
	let selectedLines: string[] | undefined = []
	let selectedByteCount = 0
	let selectedLineCount = 0
	let totalLineCount = 0
	let totalByteCount = 0
	let selectedLineStarted = false
	let selectedLineEndsWithCarriageReturn = false
	let selectedLineParts: string[] = []

	const abortStream = () => {
		const reason = options.signal?.reason
		stream.destroy(reason instanceof Error ? reason : new Error("File read cancelled"))
	}
	if (options.signal?.aborted) abortStream()
	options.signal?.addEventListener("abort", abortStream, { once: true })

	const currentLineIsSelected = () => {
		const lineNumber = totalLineCount + 1
		return lineNumber >= options.startLine && (options.endLine === undefined || lineNumber <= options.endLine)
	}

	const beginSelectedLine = () => {
		if (selectedLineStarted || !currentLineIsSelected()) return
		selectedLineStarted = true
		if (selectedLineCount > 0) selectedByteCount++
		selectedLineCount++
		if (selectedByteCount > options.maxSelectedBytes + 1) selectedLines = undefined
	}

	const acceptLineFragment = (fragment: string) => {
		if (!currentLineIsSelected()) return
		beginSelectedLine()
		if (fragment.length > 0) selectedLineEndsWithCarriageReturn = fragment.endsWith("\r")
		selectedByteCount += Buffer.byteLength(fragment, "utf8")
		if (!selectedLines) return
		if (selectedByteCount > options.maxSelectedBytes + 1) {
			selectedLines = undefined
			selectedLineParts = []
			return
		}
		selectedLineParts.push(fragment)
	}

	const finishLine = () => {
		if (currentLineIsSelected()) {
			beginSelectedLine()
			if (selectedLineEndsWithCarriageReturn) {
				selectedByteCount--
				if (selectedLines) {
					for (let index = selectedLineParts.length - 1; index >= 0; index--) {
						if (selectedLineParts[index].length === 0) continue
						selectedLineParts[index] = selectedLineParts[index].slice(0, -1)
						break
					}
				}
			}
			if (selectedByteCount > options.maxSelectedBytes) selectedLines = undefined
			if (selectedLines) selectedLines.push(selectedLineParts.join(""))
		}

		totalLineCount++
		if (totalLineCount > options.maxRetainedLines) {
			retainCompleteText = false
			completeChunks.length = 0
		}
		selectedLineStarted = false
		selectedLineEndsWithCarriageReturn = false
		selectedLineParts = []
	}

	const acceptDecodedText = (text: string) => {
		if (retainCompleteText) {
			retainedByteCount += Buffer.byteLength(text, "utf8")
			if (retainedByteCount > options.maxRetainedBytes) {
				retainCompleteText = false
				completeChunks.length = 0
			} else {
				completeChunks.push(text)
			}
		}
		let fragmentStart = 0
		let newlineIndex = text.indexOf("\n")
		while (newlineIndex !== -1) {
			acceptLineFragment(text.slice(fragmentStart, newlineIndex))
			finishLine()
			fragmentStart = newlineIndex + 1
			newlineIndex = text.indexOf("\n", fragmentStart)
		}
		acceptLineFragment(text.slice(fragmentStart))
	}

	const decodePendingBytes = async () => {
		if (pendingByteCount === 0) return
		const sample = Buffer.concat(pendingBytes, pendingByteCount)
		const extension = path.extname(filePath).toLowerCase()
		const encoding = await detectEncoding(sample, extension)
		assertTextSample(sample, encoding, extension)
		decoder = iconv.getDecoder(encoding)
		pendingBytes = []
		pendingByteCount = 0
		acceptDecodedText(decoder.write(sample))
	}

	try {
		for await (const chunk of stream) {
			const bytes = chunk as Buffer
			totalByteCount += bytes.length
			if (decoder) {
				acceptDecodedText(decoder.write(bytes))
				continue
			}
			const isPlainAsciiText = pendingByteCount === 0 && bytes.every(
				(byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127),
			)
			if (isPlainAsciiText) {
				acceptDecodedText(bytes.toString("ascii"))
				continue
			}
			pendingBytes.push(bytes)
			pendingByteCount += bytes.length
			if (pendingByteCount >= 256 * 1024) await decodePendingBytes()
		}
		await decodePendingBytes()
		if (decoder) acceptDecodedText(decoder.end() ?? "")
		finishLine()
	} finally {
		options.signal?.removeEventListener("abort", abortStream)
		stream.destroy()
	}

	return {
		selectedLines,
		selectedByteCount,
		totalLineCount,
		totalByteCount,
		completeText: retainCompleteText ? completeChunks.join("") : undefined,
	}
}

/** Counts text lines with the same semantics as String.split(/\\r?\\n/), without retaining file content. */
export async function countTextFileLines(filePath: string, signal?: AbortSignal): Promise<number> {
	const result = await readTextFileWindow(filePath, {
		startLine: Number.MAX_SAFE_INTEGER,
		maxSelectedBytes: 0,
		maxRetainedLines: 0,
		maxRetainedBytes: 0,
		signal,
	})
	return result.totalLineCount
}

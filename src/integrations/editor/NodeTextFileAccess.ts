import * as fs from "fs/promises"
import * as iconv from "iconv-lite"
import { detectEncoding } from "../misc/extract-text"
import type { TextFileAccess, TextFileReadResult, TextFileWriteResult } from "./TextFileAccess"

export class NodeTextFileAccess implements TextFileAccess {
	async readText(path: string): Promise<TextFileReadResult> {
		const fileBuffer = await fs.readFile(path)
		const encoding = await detectEncoding(fileBuffer)
		return {
			content: iconv.decode(fileBuffer, encoding),
			encoding,
		}
	}

	async writeText(path: string, content: string): Promise<TextFileWriteResult> {
		await fs.writeFile(path, content, { encoding: "utf8" })
		return { content }
	}
}

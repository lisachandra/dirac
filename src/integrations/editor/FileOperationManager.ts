import * as fs from "fs/promises"
import { createDirectoriesForFile } from "@utils/fs"
import { NodeTextFileAccess } from "./NodeTextFileAccess"
import type { TextFileAccess, TextFileWriteResult } from "./TextFileAccess"
import { sanitizeNotebookForLLM } from "../misc/notebook-utils"

export class FileOperationManager {
	private createdDirs: string[] = []
	originalContent: string | undefined
	fileEncoding: string

	constructor(
		private absolutePath: string,
		private editType: "create" | "modify" | "delete",
		private textFileAccess: TextFileAccess = new NodeTextFileAccess(),
	) {
		this.fileEncoding = "utf8"
	}

	async setup(): Promise<void> {
		if (this.editType === "modify") {
			const result = await this.textFileAccess.readText(this.absolutePath)
			this.fileEncoding = result.encoding
			this.originalContent = result.content
		} else {
			this.originalContent = ""
			this.fileEncoding = "utf8"
		}

		this.createdDirs = this.editType === "create" ? await createDirectoriesForFile(this.absolutePath) : []

		if (this.editType === "create") {
			await this.textFileAccess.writeText(this.absolutePath, "")
		}
	}

	async ensureFileExists(): Promise<void> {
		if (this.editType === "create") {
			const exists = await fs
				.stat(this.absolutePath)
				.then(() => true)
				.catch(() => false)
			if (!exists) {
				await this.textFileAccess.writeText(this.absolutePath, "")
			}
		}
	}

	async writeFile(content: string): Promise<TextFileWriteResult> {
		return this.textFileAccess.writeText(this.absolutePath, content)
	}

	async readFile(): Promise<string> {
		return (await this.textFileAccess.readText(this.absolutePath)).content
	}

	async deleteFile(): Promise<void> {
		await fs.rm(this.absolutePath)
	}

	async deleteCreatedDirs(): Promise<string[]> {
		const deleted: string[] = []
		for (let i = this.createdDirs.length - 1; i >= 0; i--) {
			try {
				await fs.rmdir(this.createdDirs[i])
				deleted.push(this.createdDirs[i])
			} catch {
				// Directory may not exist or be non-empty, skip
			}
		}
		this.createdDirs = []
		return deleted
	}

	getCreatedDirs(): string[] {
		return [...this.createdDirs]
	}

	getOriginalContentForLLM(isNotebookFile: boolean): string | undefined {
		if (this.originalContent === undefined) return undefined
		return isNotebookFile ? sanitizeNotebookForLLM(this.originalContent, true) : this.originalContent
	}

	reset(): void {
		this.createdDirs = []
		this.originalContent = undefined
		this.fileEncoding = "utf8"
	}
}

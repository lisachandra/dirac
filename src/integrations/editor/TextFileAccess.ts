export interface TextFileReadResult {
	content: string
	encoding: string
}

export interface TextFileWriteResult {
	content: string
}

export interface TextFileAccess {
	readText(path: string): Promise<TextFileReadResult>
	writeText(path: string, content: string): Promise<TextFileWriteResult>
}

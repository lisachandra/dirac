export interface TextFileWindowOptions {
	startLine: number
	endLine?: number
	maxSelectedBytes: number
	maxRetainedLines: number
	maxRetainedBytes: number
	signal?: AbortSignal
}

export interface TextFileWindow {
	selectedLines?: string[]
	selectedByteCount: number
	totalLineCount: number
	totalByteCount: number
	completeText?: string
}

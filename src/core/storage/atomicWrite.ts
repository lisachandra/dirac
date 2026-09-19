import * as fs from "fs/promises"
import * as path from "path"

// Atomically write data to a file using temp file + rename pattern.
// Prevents readers from seeing partial data by writing to a temp file first, then renaming.
// Both the temp file and its directory are synced before returning, so a power loss cannot
// leave a rename committed with the file contents still unwritten (which surfaces as a
// zero-length or NUL-filled file).
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	let handle: fs.FileHandle | undefined
	try {
		handle = await fs.open(tmpPath, "wx")
		await handle.writeFile(data, "utf8")
		await handle.sync()
		await handle.close()
		handle = undefined
		await fs.rename(tmpPath, filePath)
		await syncDirectory(path.dirname(filePath))
	} catch (error) {
		if (handle) {
			await handle.close().catch(() => {})
		}
		await fs.unlink(tmpPath).catch(() => {})
		throw error
	}
}

// Syncs a directory entry so the rename itself survives a power loss.
// Windows rejects directory handles opened for reading, which is safe to ignore.
async function syncDirectory(directoryPath: string): Promise<void> {
	let handle: fs.FileHandle | undefined
	try {
		handle = await fs.open(directoryPath, "r")
		await handle.sync()
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (process.platform === "win32" && (code === "EINVAL" || code === "EPERM" || code === "EISDIR")) {
			return
		}
		throw error
	} finally {
		if (handle) {
			await handle.close().catch(() => {})
		}
	}
}

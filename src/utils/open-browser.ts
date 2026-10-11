/** Launch a browser and report immediate launcher failures without waiting for it to quit. */
export async function openBrowser(url: string): Promise<void> {
	const { default: open } = await import("open")
	const child = await open(url)
	// Some Linux launchers stay alive for the browser's lifetime. Observe only startup.
	const startupObservationMs = 1000
	await new Promise<void>((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout> | undefined
		const finish = (error?: Error) => {
			clearTimeout(timeout)
			child.removeListener("spawn", onSpawn)
			child.removeListener("error", onError)
			child.removeListener("close", onClose)
			if (error) reject(error)
			else resolve()
		}
		const onSpawn = () => {
			timeout = setTimeout(() => finish(), startupObservationMs)
		}
		const onError = (error: Error) => finish(error)
		const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
			finish(code === 0 ? undefined : new Error(`Browser launcher failed (${signal ?? `exit code ${code}`})`))
		}
		child.once("error", onError)
		child.once("close", onClose)
		if (child.pid !== undefined) onSpawn()
		else child.once("spawn", onSpawn)
	})
}

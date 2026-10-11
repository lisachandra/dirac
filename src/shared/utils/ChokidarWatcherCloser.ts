import type { FSWatcher } from "chokidar"

/** Coordinates Chokidar watcher closure and shares in-flight close promises. */
export class ChokidarWatcherCloser {
	private readonly ownedWatchers = new Set<FSWatcher>()
	private readonly activeClosures = new Map<FSWatcher, Promise<void>>()

	public close(watcher: FSWatcher): Promise<void> {
		const activeClosure = this.activeClosures.get(watcher)
		if (activeClosure) return activeClosure

		this.ownedWatchers.add(watcher)
		const closure = watcher.close().finally(() => {
			this.activeClosures.delete(watcher)
			this.ownedWatchers.delete(watcher)
		})
		this.activeClosures.set(watcher, closure)
		return closure
	}

	public async closeAll(watchers: Iterable<FSWatcher> = []): Promise<void> {
		for (const watcher of watchers) this.ownedWatchers.add(watcher)
		await Promise.all([...this.ownedWatchers].map((watcher) => this.close(watcher)))
	}
}

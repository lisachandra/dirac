import { EventEmitter } from "node:events"
import type { FSWatcher } from "chokidar"
import { afterEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { IgnoreFileWatcher } from "./IgnoreFileWatcher"

describe("IgnoreFileWatcher", () => {
	afterEach(() => sinon.restore())

	it("does not install a watcher after disposal interrupts startup", async () => {
		sinon.stub(Logger, "error")
		let releaseClose!: () => void
		const pendingClose = new Promise<void>((resolve) => {
			releaseClose = resolve
		})
		const watcher = new EventEmitter() as FSWatcher
		watcher.close = sinon.stub().returns(pendingClose)
		const watcherFactory = sinon.stub().returns(watcher)
		const fileWatcher = new IgnoreFileWatcher("/workspace", watcherFactory)
		await fileWatcher.start(() => undefined)
		watcher.emit("error", new Error("injected watcher failure"))

		const restart = fileWatcher.start(() => undefined)
		const disposal = fileWatcher.dispose()
		releaseClose()
		await Promise.all([restart, disposal])

		watcherFactory.calledOnce.should.be.true()
	})
})

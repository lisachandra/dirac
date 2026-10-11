import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { ToolExecutor } from "../ToolExecutor"

function browserSettings(remoteBrowserHost: string) {
	return {
		viewport: { width: 900, height: 700 },
		remoteBrowserEnabled: true,
		remoteBrowserHost,
		disableToolUse: false,
		customArgs: "",
	} as any
}

describe("ToolExecutor browser request runtime", () => {
	it("recreates the browser from request-bound settings rather than newer Task settings", async () => {
		const requestSettings = browserSettings("request.example")
		const newerTaskSettings = browserSettings("newer-task.example")
		const dispose = sinon.stub().resolves()
		const fakeExecutor = {
			browserSession: { dispose },
			ulid: "task-ulid",
			requestRuntime: () => ({
				api: { getModel: () => ({ id: "claude-test", info: {} }) },
				workingConfiguration: { settings: { browserSettings: requestSettings } },
			}),
			getCurrentWorkingConfiguration: () => ({ settings: { browserSettings: newerTaskSettings } }),
		}

		const session = await ToolExecutor.prototype.applyLatestBrowserSettings.call(fakeExecutor as any)
		const connection = (session as any).connection

		sinon.assert.calledOnce(dispose)
		assert.deepEqual(connection.settingsSource, requestSettings)
		assert.notDeepEqual(connection.settingsSource, newerTaskSettings)
		assert.equal((session as any).useWebp, true)
		assert.equal(connection.ulid, "task-ulid")
	})
})

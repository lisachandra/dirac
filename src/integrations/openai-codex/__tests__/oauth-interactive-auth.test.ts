import { EventEmitter } from "events"
import * as http from "http"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { OpenAiCodexOAuthManager } from "../oauth"
import { OAuthFlowHandler } from "../OAuthFlowHandler"

function stubCallbackServer() {
	const server = Object.assign(new EventEmitter(), { listen: sinon.stub(), close: sinon.stub() })
	sinon.stub(http, "createServer").returns(server as unknown as http.Server)
	return server
}

describe("interactive ChatGPT sign-in", () => {
	afterEach(() => sinon.restore())

	it("publishes a browser URL with a listening callback server and settles on cancellation", async () => {
		const server = stubCallbackServer()
		const abort = new AbortController()
		const ready = sinon.spy(({ url }: { url: string }) => {
			url.should.startWith("https://auth.openai.com/oauth/authorize?")
			sinon.assert.calledOnce(server.listen)
			abort.abort()
		})
		await new OpenAiCodexOAuthManager()
			.authenticate("browser", ready, abort.signal)
			.should.be.rejectedWith("Browser authentication was cancelled.")
		sinon.assert.calledOnce(ready)
		sinon.assert.calledOnce(server.close)
	})

	it("settles malformed callback requests without rejecting the HTTP listener", async () => {
		const server = stubCallbackServer()
		const result = new OpenAiCodexOAuthManager().authenticate("browser", () => { }, new AbortController().signal)
		const assertion = result.should.be.rejectedWith("Invalid URL")
		const listener = (http.createServer as sinon.SinonStub).firstCall.args[0]
		const response = { writeHead: sinon.stub().returnsThis(), end: sinon.stub() }

		await listener({ url: "//[" }, response)
		await assertion
		sinon.assert.calledWithExactly(response.writeHead, 400)
		sinon.assert.calledWithExactly(response.end, "Authentication failed. Return to Dirac to retry.")
		sinon.assert.calledOnce(server.close)
	})

	it("does not start an already cancelled attempt", async () => {
		const server = stubCallbackServer()
		const abort = new AbortController()
		abort.abort()
		const ready = sinon.spy()
		await new OpenAiCodexOAuthManager().authenticate("browser", ready, abort.signal).should.be.rejected()
		sinon.assert.notCalled(ready)
		sinon.assert.notCalled(server.listen)
	})

	it("cleans up the browser listener if delivering instructions fails", async () => {
		const server = stubCallbackServer()
		await new OpenAiCodexOAuthManager()
			.authenticate(
				"browser",
				() => {
					throw new Error("View disconnected")
				},
				new AbortController().signal,
			)
			.should.be.rejectedWith("View disconnected")
		sinon.assert.calledOnce(server.close)
	})

	it("cancelling an old attempt does not cancel a newer attempt", async () => {
		stubCallbackServer()
		const manager = new OpenAiCodexOAuthManager()
		const first = new AbortController()
		const second = new AbortController()
		const firstResult = manager.authenticate("browser", () => { }, first.signal)
		const firstAssertion = firstResult.should.be.rejectedWith("Browser authentication was cancelled.")
		const secondResult = manager.authenticate("browser", () => { }, second.signal)
		let secondSettled = false
		const secondAssertion = secondResult.should.be.rejectedWith("Browser authentication was cancelled.").then(() => {
			secondSettled = true
		})
		first.abort()
		await firstAssertion
		secondSettled.should.be.false()
		second.abort()
		await secondAssertion
	})

	it("keeps device polling identifiers private and shares the cancellation signal", async () => {
		const abort = new AbortController()
		const initiate = sinon.stub(OAuthFlowHandler.prototype, "initiateDeviceFlow").resolves({
			device_code: "private-device-id",
			user_code: "ABCD-EFGH",
			verification_uri: "https://auth.openai.com/codex/device",
			interval: 5,
		})
		const poll = sinon.stub(OAuthFlowHandler.prototype, "pollForDeviceToken").resolves()
		const ready = sinon.spy()
		await new OpenAiCodexOAuthManager().authenticate("device", ready, abort.signal)
		sinon.assert.calledWithExactly(initiate, abort.signal)
		sinon.assert.calledWithExactly(ready, { url: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" })
		sinon.assert.calledWithExactly(poll, "private-device-id", "ABCD-EFGH", 5, abort.signal)
	})

	it("does not publish a device code or start polling after cancellation during initiation", async () => {
		const abort = new AbortController()
		sinon.stub(OAuthFlowHandler.prototype, "initiateDeviceFlow").callsFake(async () => {
			abort.abort()
			return { device_code: "private", user_code: "code", verification_uri: "https://auth.openai.com/codex/device" }
		})
		const poll = sinon.stub(OAuthFlowHandler.prototype, "pollForDeviceToken")
		const ready = sinon.spy()
		await new OpenAiCodexOAuthManager().authenticate("device", ready, abort.signal).should.be.rejected()
		sinon.assert.notCalled(ready)
		sinon.assert.notCalled(poll)
	})
})

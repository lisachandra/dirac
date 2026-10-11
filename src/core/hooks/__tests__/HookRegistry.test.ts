import { expect } from "chai"
import { describe, it } from "mocha"
import { HookRegistry } from "../HookRegistry"

describe("HookRegistry.isGlobalHooksDir", () => {
	it("recognizes legacy ~/Documents/Dirac/Hooks path", () => {
		expect(HookRegistry.isGlobalHooksDir("/Users/user/Documents/Dirac/Hooks")).to.be.true
		expect(HookRegistry.isGlobalHooksDir("/Users/user/Documents/dirac/hooks")).to.be.true
		expect(HookRegistry.isGlobalHooksDir("C:\\Users\\user\\Documents\\Dirac\\Hooks")).to.be.true
	})

	// Review fix #2: relocated global hooks at ~/.dirac/Hooks must be classified as global.
	it("recognizes new ~/.dirac/Hooks path", () => {
		expect(HookRegistry.isGlobalHooksDir("/Users/user/.dirac/Hooks")).to.be.true
		expect(HookRegistry.isGlobalHooksDir("/Users/user/.dirac/hooks")).to.be.true
		expect(HookRegistry.isGlobalHooksDir("C:\\Users\\user\\.dirac\\Hooks")).to.be.true
	})

	it("rejects workspace hooks dirs", () => {
		expect(HookRegistry.isGlobalHooksDir("/project/.diracrules/hooks")).to.be.false
		expect(HookRegistry.isGlobalHooksDir("/project/hooks")).to.be.false
	})
})

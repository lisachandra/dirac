import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { buildWorkspaceTrait } from "../WorkspaceTraitBuilder"

const temporaryDirectories: string[] = []

afterEach(async () => {
	sinon.restore()
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe("WorkspaceTraitBuilder mutation authorization", () => {
	function callbacks(assertMutationAuthorized: sinon.SinonStub) {
		return {
			assertMutationAuthorized,
			withMutationAuthorization: async (toolName: string, mutation: () => Promise<unknown>) => {
				assertMutationAuthorized(toolName)
				return await mutation()
			},
		}
	}

	it("holds authorization through the workspace file write", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-workspace-auth-"))
		temporaryDirectories.push(directory)
		const file = path.join(directory, "file.txt")
		const assertMutationAuthorized = sinon.stub()
		const config = {
			toolUse: { name: "write_to_file", params: {} },
			callbacks: callbacks(assertMutationAuthorized),
		} as any
		const trait = buildWorkspaceTrait(config)

		await trait.writeFile(file, "written")

		sinon.assert.calledOnceWithExactly(assertMutationAuthorized, "write_to_file")
		assert.equal(await fs.readFile(file, "utf8"), "written")
	})

	it("fails closed for a custom tool before entering the filesystem boundary", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-workspace-auth-"))
		temporaryDirectories.push(directory)
		const file = path.join(directory, "file.txt")
		const assertMutationAuthorized = sinon.stub().throws(new Error("Plan Mode revoked mutation"))
		const config = {
			toolUse: { name: "custom_writer", params: {} },
			callbacks: callbacks(assertMutationAuthorized),
		} as any
		const trait = buildWorkspaceTrait(config)

		await assert.rejects(trait.writeFile(file, "blocked"), /Plan Mode revoked mutation/)
		await assert.rejects(fs.access(file))
	})
})

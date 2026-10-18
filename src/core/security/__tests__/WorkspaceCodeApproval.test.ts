import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { approvedWorkspaceCode, approvedWorkspaceHookBundle } from "../WorkspaceCodeApproval"

describe("workspace code grants", () => {
	let root: string
	let workspace: string
	let entry: string
	let selectedOption: string | undefined
	let trusted: boolean
	let prompts: number
	let restore: () => void

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-workspace-grant-"))
		workspace = path.join(root, "checkout")
		await fs.mkdir(workspace)
		entry = path.join(workspace, "TaskStart")
		await fs.writeFile(entry, "approved")
		selectedOption = undefined
		trusted = true
		prompts = 0
		const stub = sinon.stub(HostProvider, "get").returns({
			globalStorageFsPath: root,
			diracType: "extension",
			isWorkspaceTrusted: () => trusted,
			hostBridge: {
				windowClient: {
					showMessage: async () => {
						prompts++
						return { selectedOption }
					},
				},
			},
		} as any)
		restore = () => stub.restore()
	})

	afterEach(async () => {
		restore()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("requires a human decision and remembers only approved bytes", async () => {
		assert.equal(await approvedWorkspaceCode(workspace, entry, undefined, true), undefined)
		assert.equal(prompts, 1)
		selectedOption = "Trust and run this code"
		const approved = await approvedWorkspaceCode(workspace, entry, undefined, true)
		assert.equal(approved?.source.toString(), "approved")
		assert.equal(prompts, 2)
		assert.ok(await approvedWorkspaceCode(workspace, entry))
		assert.equal(prompts, 2)
		await fs.writeFile(entry, "changed")
		assert.equal(await approvedWorkspaceCode(workspace, entry), undefined)
	})

	it("rejects symlink retargeting, workspace escapes, and restricted mode", async () => {
		selectedOption = "Trust and run this code"
		await approvedWorkspaceCode(workspace, entry, undefined, true)
		const replacement = path.join(workspace, "replacement")
		await fs.writeFile(replacement, "approved")
		await fs.unlink(entry)
		await fs.symlink(replacement, entry)
		assert.equal(await approvedWorkspaceCode(workspace, entry), undefined)
		await assert.rejects(() => approvedWorkspaceCode(workspace, root), /escapes its root/)
		trusted = false
		assert.equal(await approvedWorkspaceCode(workspace, entry, undefined, true), undefined)
	})

	it("revokes grants when the manifest changes without changing the source", async () => {
		const manifest = path.join(workspace, "dirac-tool.json")
		await fs.writeFile(manifest, '{"id":"tool"}')
		selectedOption = "Trust and run this code"
		await approvedWorkspaceCode(workspace, entry, manifest, true)
		await fs.writeFile(manifest, '{"id":"other"}')
		assert.equal(await approvedWorkspaceCode(workspace, entry, manifest), undefined)
	})
})

describe("workspace hook bundles", () => {
	let root: string
	let workspace: string
	let hooksDir: string
	let entry: string
	let selectedOption: string | undefined
	let trusted: boolean
	let restore: () => void
	let previousTrustEnv: string | undefined

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-hook-bundle-"))
		workspace = path.join(root, "checkout")
		hooksDir = path.join(workspace, ".diracrules", "hooks")
		await fs.mkdir(hooksDir, { recursive: true })
		entry = path.join(hooksDir, "PreToolUse.ps1")
		await fs.writeFile(entry, "bridge")
		await fs.writeFile(path.join(hooksDir, "PreToolUse.js"), "implementation")
		await fs.writeFile(path.join(workspace, ".diracrules", "settings.json"), '{"hooks":{}}')
		selectedOption = undefined
		trusted = true
		previousTrustEnv = process.env.DIRAC_TRUST_WORKSPACE_HOOKS
		delete process.env.DIRAC_TRUST_WORKSPACE_HOOKS
		const stub = sinon.stub(HostProvider, "get").returns({
			globalStorageFsPath: root,
			diracType: "extension",
			isWorkspaceTrusted: () => trusted,
			hostBridge: {
				windowClient: {
					showMessage: async () => ({ selectedOption }),
				},
			},
		} as any)
		restore = () => stub.restore()
	})

	afterEach(async () => {
		restore()
		if (previousTrustEnv === undefined) delete process.env.DIRAC_TRUST_WORKSPACE_HOOKS
		else process.env.DIRAC_TRUST_WORKSPACE_HOOKS = previousTrustEnv
		await fs.rm(root, { recursive: true, force: true })
	})

	it("approves through a symlinked hooks dir that resolves outside the workspace", async () => {
		const shared = await fs.mkdtemp(path.join(os.tmpdir(), "dirac-shared-agents-"))
		try {
			const sharedHooks = path.join(shared, "hooks")
			await fs.mkdir(sharedHooks, { recursive: true })
			await fs.writeFile(path.join(sharedHooks, "PreToolUse.ps1"), "shared bridge")
			await fs.writeFile(path.join(sharedHooks, "PreToolUse.js"), "shared implementation")
			await fs.writeFile(path.join(shared, "settings.json"), '{"hooks":{"PreToolUse":[]}}')
			await fs.rm(path.dirname(hooksDir), { recursive: true, force: true })
			await fs.symlink(shared, path.dirname(hooksDir), "junction")

			selectedOption = "Trust and run this code"
			const approved = await approvedWorkspaceHookBundle(workspace, entry, true)

			assert.ok(approved, "symlink-resolved hook bundle should be approvable")
			assert.equal(approved?.files.get("hooks/PreToolUse.ps1")?.toString(), "shared bridge")
			assert.equal(approved?.files.get("hooks/PreToolUse.js")?.toString(), "shared implementation")
			assert.equal(approved?.files.get("settings.json")?.toString(), '{"hooks":{"PreToolUse":[]}}')
			assert.equal(approved?.entry, "hooks/PreToolUse.ps1")
			assert.ok(approved?.digest)
			// Second call is served from the stored grant without prompting.
			selectedOption = undefined
			assert.ok(await approvedWorkspaceHookBundle(workspace, entry, true))
		} finally {
			await fs.rm(shared, { recursive: true, force: true })
		}
	})

	it("revokes the grant when any bundle file changes", async () => {
		selectedOption = "Trust and run this code"
		assert.ok(await approvedWorkspaceHookBundle(workspace, entry, true))
		await fs.writeFile(path.join(hooksDir, "PreToolUse.js"), "changed implementation")
		assert.equal(await approvedWorkspaceHookBundle(workspace, entry, false), undefined)
	})

	it("revokes the grant when the settings file beside the hooks dir changes", async () => {
		selectedOption = "Trust and run this code"
		assert.ok(await approvedWorkspaceHookBundle(workspace, entry, true))
		await fs.writeFile(path.join(workspace, ".diracrules", "settings.json"), '{"hooks":{"PreToolUse":["new"]}}')
		assert.equal(await approvedWorkspaceHookBundle(workspace, entry, false), undefined)
	})

	it("trusts the bundle unattended only when the opt-in env var is set", async () => {
		assert.equal(await approvedWorkspaceHookBundle(workspace, entry, true), undefined)
		process.env.DIRAC_TRUST_WORKSPACE_HOOKS = "true"
		const approved = await approvedWorkspaceHookBundle(workspace, entry, false)
		assert.ok(approved, "opt-in env var should approve the bundle without a prompt")
		delete process.env.DIRAC_TRUST_WORKSPACE_HOOKS
		// The approval was persisted, so later runs need no env var.
		assert.ok(await approvedWorkspaceHookBundle(workspace, entry, false))
	})

	it("still rejects hook paths lexically outside the workspace", async () => {
		const outside = path.join(root, "outside-hooks")
		await fs.mkdir(outside)
		const outsideEntry = path.join(outside, "PreToolUse.ps1")
		await fs.writeFile(outsideEntry, "outside")
		await assert.rejects(() => approvedWorkspaceHookBundle(workspace, outsideEntry, true), /escapes its root/)
	})

	it("requires host workspace trust even with the opt-in env var", async () => {
		trusted = false
		process.env.DIRAC_TRUST_WORKSPACE_HOOKS = "true"
		assert.equal(await approvedWorkspaceHookBundle(workspace, entry, true), undefined)
	})
})

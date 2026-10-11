/**
 * Tests for ensureRules/Workflows/HooksDirectoryExists — FU-9.
 *
 * Verifies the relocation from the TCC-protected ~/Documents/Dirac/{Rules,Workflows,Hooks}
 * to ~/.dirac/{Rules,Workflows,Hooks}, plus the best-effort migration that copies existing
 * files without clobbering and swallows EPERM on the legacy dir.
 */
import { expect } from "chai"
import fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { ensureHooksDirectoryExists, ensureRulesDirectoryExists, ensureWorkflowsDirectoryExists } from "../directoryEnsurers"
import * as pathsModule from "../paths"

const SUBDIRS = ["Rules", "Workflows", "Hooks"] as const
type Subdir = (typeof SUBDIRS)[number]

const ENSURER: Record<Subdir, () => Promise<string>> = {
	Rules: ensureRulesDirectoryExists,
	Workflows: ensureWorkflowsDirectoryExists,
	Hooks: ensureHooksDirectoryExists,
}

describe("directoryEnsurers — FU-9 (TCC-protected path relocation)", () => {
	let sandbox: sinon.SinonSandbox
	let fakeHome: string
	let fakeDocuments: string
	let realHome: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		realHome = os.homedir()
		const tmpBase = path.join(os.tmpdir(), `dirac-ensurers-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		fakeHome = path.join(tmpBase, "home")
		fakeDocuments = path.join(tmpBase, "Documents")
		await fs.mkdir(fakeHome, { recursive: true })
		await fs.mkdir(fakeDocuments, { recursive: true })
		// Stub getDiracHomePath → ~/.dirac under fakeHome; getDocumentsPath → fakeDocuments
		sandbox.stub(pathsModule, "getDiracHomePath").returns(path.join(fakeHome, ".dirac"))
		sandbox.stub(pathsModule, "getDocumentsPath").resolves(fakeDocuments)
	})

	afterEach(async () => {
		sandbox.restore()
		// sanity: real homedir was never touched
		if (realHome !== os.homedir()) throw new Error("homedir was mutated")
	})

	for (const subdir of SUBDIRS) {
		describe(`ensure${subdir}DirectoryExists`, () => {
			it(`returns ~/.dirac/${subdir} (not ~/Documents/Dirac/${subdir})`, async () => {
				const result = await ENSURER[subdir]()
				expect(result).to.equal(path.join(fakeHome, ".dirac", subdir))
			})

			it(`creates ~/.dirac/${subdir} if it does not exist`, async () => {
				const result = await ENSURER[subdir]()
				const stat = await fs.stat(result)
				expect(stat.isDirectory()).to.be.true
			})

			it("migrates files from legacy ~/Documents/Dirac/<subdir> to the new location", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "rule1.md"), "content-1")
				await fs.writeFile(path.join(legacyDir, "rule2.md"), "content-2")

				const result = await ENSURER[subdir]()

				const migrated = await fs.readdir(result)
				expect(migrated.sort()).to.deep.equal(["rule1.md", "rule2.md"])
				expect(await fs.readFile(path.join(result, "rule1.md"), "utf8")).to.equal("content-1")
			})

			it("does not clobber existing files in the new location (idempotent)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "shared.md"), "legacy-content")

				const newDir = path.join(fakeHome, ".dirac", subdir)
				await fs.mkdir(newDir, { recursive: true })
				await fs.writeFile(path.join(newDir, "shared.md"), "new-content")

				await ENSURER[subdir]()

				expect(await fs.readFile(path.join(newDir, "shared.md"), "utf8")).to.equal("new-content")
			})

			it("swallows EPERM on legacy dir (TCC-protected ~/Documents)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "rule.md"), "content")
				// Stub readdir to reject EPERM only for the legacy dir (TCC denial)
				const realReaddir = fs.readdir.bind(fs)
				sandbox.stub(fs, "readdir").callsFake(((p: string) => {
					if (p === legacyDir) return Promise.reject(Object.assign(new Error("EPERM"), { code: "EPERM" }))
					return realReaddir(p)
				}) as typeof fs.readdir)

				const result = await ENSURER[subdir]()

				// Still returns the new dir, just without migration
				expect(result).to.equal(path.join(fakeHome, ".dirac", subdir))
				const migrated = await fs.readdir(result)
				expect(migrated).to.deep.equal([])
			})

			it("does nothing when legacy dir does not exist", async () => {
				const result = await ENSURER[subdir]()
				const migrated = await fs.readdir(result)
				expect(migrated).to.deep.equal([])
			})

			// Review fix #1: nested dirs must be migrated recursively (not skipped as EISDIR).
			it("migrates nested subdirectories from legacy dir (recursive)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(path.join(legacyDir, "nested"), { recursive: true })
				await fs.writeFile(path.join(legacyDir, "top.md"), "top")
				await fs.writeFile(path.join(legacyDir, "nested", "deep.md"), "deep")

				const result = await ENSURER[subdir]()

				expect(await fs.readFile(path.join(result, "top.md"), "utf8")).to.equal("top")
				expect(await fs.readFile(path.join(result, "nested", "deep.md"), "utf8")).to.equal("deep")
			})

			// One bad sibling must not block the rest (data safety — per-file isolation).
			it("continues migrating siblings when one copyFile fails", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "good.md"), "good")
				await fs.writeFile(path.join(legacyDir, "bad.md"), "bad")
				const realCopyFile = fs.copyFile.bind(fs)
				sandbox.stub(fs, "copyFile").callsFake(((src: string, dest: string, mode?: number) => {
					if (src.endsWith("bad.md")) return Promise.reject(Object.assign(new Error("EIO"), { code: "EIO" }))
					return realCopyFile(src, dest, mode)
				}) as typeof fs.copyFile)

				const result = await ENSURER[subdir]()

				expect(await fs.readFile(path.join(result, "good.md"), "utf8")).to.equal("good")
				await fs.stat(path.join(result, "bad.md")).then(
					() => expect.fail("bad.md should not have been migrated"),
					() => undefined,
				)
			})

			// Review fix #3: EACCES is an expected legacy-path denial, same class as EPERM.
			it("swallows EACCES on legacy dir", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				await fs.writeFile(path.join(legacyDir, "rule.md"), "content")
				const realReaddir = fs.readdir.bind(fs)
				sandbox.stub(fs, "readdir").callsFake(((p: string) => {
					if (p === legacyDir) return Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }))
					return realReaddir(p)
				}) as typeof fs.readdir)

				const result = await ENSURER[subdir]()

				expect(result).to.equal(path.join(fakeHome, ".dirac", subdir))
				expect(await fs.readdir(result)).to.deep.equal([])
			})
			it("does not create a destination subtree when its legacy source is inaccessible", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				const nestedLegacyDir = path.join(legacyDir, "inaccessible")
				await fs.mkdir(nestedLegacyDir, { recursive: true })
				const realReaddir = fs.readdir.bind(fs)
				sandbox.stub(fs, "readdir").callsFake(((p: string) => {
					if (p === nestedLegacyDir) return Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }))
					return realReaddir(p, { withFileTypes: true })
				}) as unknown as typeof fs.readdir)

				const result = await ENSURER[subdir]()

				await fs.stat(path.join(result, "inaccessible")).then(
					() => expect.fail("inaccessible legacy subtree should not create a destination subtree"),
					(error: NodeJS.ErrnoException) => expect(error.code).to.equal("ENOENT"),
				)
			})

			it("rejects when a nested destination directory cannot be created", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				const nestedLegacyDir = path.join(legacyDir, "nested")
				const nestedDestinationDir = path.join(fakeHome, ".dirac", subdir, "nested")
				await fs.mkdir(nestedLegacyDir, { recursive: true })
				await fs.writeFile(path.join(nestedLegacyDir, "rule.md"), "content")
				const realMkdir = fs.mkdir.bind(fs)
				sandbox.stub(fs, "mkdir").callsFake(((p: string, options?: Parameters<typeof fs.mkdir>[1]) => {
					if (p === nestedDestinationDir) {
						return Promise.reject(Object.assign(new Error("destination denied"), { code: "EACCES" }))
					}
					return realMkdir(p, options as any)
				}) as typeof fs.mkdir)

				await ENSURER[subdir]().then(
					() => expect.fail("destination mkdir failure should reject"),
					(error: NodeJS.ErrnoException) => expect(error.code).to.equal("EACCES"),
				)
			})
			// Review fix #3: unexpected errors must be logged and rethrown, not swallowed.
			it("rejects on unexpected readdir errors (not ENOENT/EPERM/EACCES)", async () => {
				const legacyDir = path.join(fakeDocuments, "Dirac", subdir)
				await fs.mkdir(legacyDir, { recursive: true })
				const warnStub = sandbox.stub(Logger, "warn")
				const realReaddir = fs.readdir.bind(fs)
				sandbox.stub(fs, "readdir").callsFake(((p: string) => {
					if (p === legacyDir) return Promise.reject(Object.assign(new Error("ENOSYS"), { code: "ENOSYS" }))
					return realReaddir(p)
				}) as typeof fs.readdir)

				await ENSURER[subdir]().then(
					() => expect.fail("unexpected migration error should reject"),
					(error) => {
						expect((error as NodeJS.ErrnoException).code).to.equal("ENOSYS")
					},
				)
				expect(warnStub.called).to.be.true
				expect(String(warnStub.firstCall.args[0])).to.match(/migration: failed/)
			})
		})
	}
})

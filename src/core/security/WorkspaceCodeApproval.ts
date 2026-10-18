import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import Mutex from "p-mutex"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { atomicWriteFile } from "@core/storage/atomicWrite"

/** A grant is for these exact bytes at this path and target, never for a repository or tool ID alone. */
export interface WorkspaceCodeSnapshot {
	readonly source: Buffer
	readonly manifestSource?: Buffer
	readonly digest: string
	readonly target: string
}

/** A hook bundle: the entry script plus every sibling file it may load, keyed by path relative to the materialized root. */
export interface WorkspaceHookBundleSnapshot {
	/** File contents keyed by bundle-relative path (e.g. "hooks/PreToolUse.ps1", "settings.json"). */
	readonly files: ReadonlyMap<string, Buffer>
	/** Bundle-relative path of the entry script to launch. */
	readonly entry: string
	readonly digest: string
	readonly target: string
}

const approvalMutex = new Mutex()
const APPROVE = "Trust and run this code"
const REVIEW = "Review source"

/**
 * Unattended trust for workspace hooks: sandcastle/CI runs cannot answer the
 * interactive approval prompt, so they opt in explicitly. The grant still binds
 * exact bytes and still requires host workspace trust.
 */
const SKIP_APPROVAL_ENV = "DIRAC_TRUST_WORKSPACE_HOOKS"

/**
 * Hook bundles are small script collections; this cap keeps a runaway hooks
 * directory from being read into memory during approval.
 */
const MAX_HOOK_BUNDLE_BYTES = 8 * 1024 * 1024

/** Every entry in a hooks directory is a candidate artifact: shims load siblings by name. */
function isHookBundleFile(name: string): boolean {
	return !name.startsWith(".") && name !== "disabled"
}

function inside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate)
	return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Whether a lexical path reaches outside the workspace only because of
 * symlinks. A lexical path inside the root that resolves outside it is the
 * shared-agents layout (.diracrules -> ~/.agents -> shared dir), where the
 * link is the point of the design; a lexical path outside the root is a real
 * escape and is always rejected.
 */
function isLexicallyInsideWorkspace(lexicalRoot: string, candidate: string): boolean {
	const relative = path.relative(lexicalRoot, candidate)
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function fingerprint(workspaceRoot: string, entrypoint: string, manifest?: string): Promise<{ key: string; snapshot: WorkspaceCodeSnapshot }> {
	const lexicalRoot = path.resolve(workspaceRoot)
	const root = await fs.realpath(lexicalRoot)
	const entry = path.resolve(entrypoint)
	if (!inside(lexicalRoot, entry)) throw new Error(`Workspace code path escapes its root: ${entry}`)
	const canonicalEntry = path.join(root, path.relative(lexicalRoot, entry))
	const target = await fs.realpath(canonicalEntry)
	if (!inside(root, target)) throw new Error(`Workspace code target escapes its root: ${entry}`)
	const source = await fs.readFile(target)
	const digest = createHash("sha256")
	let manifestSource: Buffer | undefined
	if (manifest) {
		const manifestPath = path.resolve(manifest)
		if (!inside(lexicalRoot, manifestPath)) throw new Error(`Workspace tool manifest escapes its root: ${manifestPath}`)
		const manifestTarget = await fs.realpath(path.join(root, path.relative(lexicalRoot, manifestPath)))
		if (!inside(root, manifestTarget)) throw new Error(`Workspace tool manifest escapes its root: ${manifestPath}`)
		manifestSource = await fs.readFile(manifestTarget)
		digest.update(manifestSource).update("\0")
	}
	digest.update(source)
	const hex = digest.digest("hex")
	return { key: JSON.stringify([root, path.relative(root, canonicalEntry), target, hex]), snapshot: { source, manifestSource, target, digest: hex } }
}

async function grantsPath(): Promise<string> {
	const directory = path.join(HostProvider.get().globalStorageFsPath, "security")
	await fs.mkdir(directory, { recursive: true })
	return path.join(directory, "workspace-code-grants.json")
}

async function readGrants(file: string): Promise<string[]> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as string[]
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
}

/**
 * Reads a hook bundle: the hooks directory plus the settings file next to it.
 *
 * The layout matters. Hook scripts resolve policy relative to their own
 * location (a PowerShell shim reads `<hooks>/../settings.json` and dispatches
 * to `<hooks>/run-hook.cmd`), so the bundle records each file under its path
 * relative to the agents root and the snapshot is materialized with that
 * structure preserved.
 *
 * Hashing name+bytes means any addition, removal, or edit revokes the grant.
 */
async function readHookBundle(hooksDir: string): Promise<{ files: Map<string, Buffer>; digest: string }> {
	const entries = await fs.readdir(hooksDir, { withFileTypes: true })
	const names = entries
		.filter((entry) => !entry.isDirectory() && isHookBundleFile(entry.name))
		.map((entry) => entry.name)
		.sort()

	const hooksDirName = path.basename(hooksDir)
	const files = new Map<string, Buffer>()
	const digest = createHash("sha256")
	let bytes = 0

	for (const name of names) {
		const content = await fs.readFile(path.join(hooksDir, name))
		bytes += content.byteLength
		if (bytes > MAX_HOOK_BUNDLE_BYTES) throw new Error(`Workspace hook bundle exceeds ${MAX_HOOK_BUNDLE_BYTES} bytes: ${hooksDir}`)
		const relative = `${hooksDirName}/${name}`
		files.set(relative, content)
		digest.update(relative).update("\0").update(content).update("\0")
	}

	// The shims read the hook policy from the settings file beside the hooks
	// directory; without it in the bundle they would run from a snapshot with
	// no configuration and silently allow everything.
	const settingsPath = path.join(path.dirname(hooksDir), "settings.json")
	try {
		const settings = await fs.readFile(settingsPath)
		bytes += settings.byteLength
		if (bytes > MAX_HOOK_BUNDLE_BYTES) throw new Error(`Workspace hook bundle exceeds ${MAX_HOOK_BUNDLE_BYTES} bytes: ${hooksDir}`)
		files.set("settings.json", settings)
		digest.update("settings.json").update("\0").update(settings).update("\0")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
	}

	return { files, digest: digest.digest("hex") }
}

/**
 * Approves a workspace hook bundle for execution.
 *
 * Hooks differ from single-file workspace code in two ways:
 *  - the discovered path may be a symlink into a shared agents directory, so
 *    the resolved target legitimately sits outside the workspace root; the
 *    lexical path must still be inside it (no configured path escapes).
 *  - the entry script loads sibling files (a `.ps1` PowerShell bridge next to
 *    its `.js` implementation, or a settings.json dispatcher), so the grant
 *    and the materialized snapshot cover the whole bundle, not just the entry.
 */
export async function approvedWorkspaceHookBundle(
	workspaceRoot: string,
	entrypoint: string,
	prompt = false,
): Promise<WorkspaceHookBundleSnapshot | undefined> {
	return approvalMutex.withLock(async () => {
		const lexicalRoot = path.resolve(workspaceRoot)
		const entry = path.resolve(entrypoint)
		if (!isLexicallyInsideWorkspace(lexicalRoot, entry)) {
			throw new Error(`Workspace hook path escapes its root: ${entry}`)
		}

		const root = await fs.realpath(lexicalRoot)
		const target = await fs.realpath(entry)
		const hooksDir = path.dirname(target)
		const { files, digest } = await readHookBundle(hooksDir)
		// The entry script keeps its position inside the hooks directory so the
		// snapshot preserves the layout the script resolves siblings against.
		const bundlePath = `${path.basename(hooksDir)}/${path.basename(target)}`
		if (!files.has(bundlePath)) throw new Error(`Workspace hook entry not found in its bundle: ${target}`)

		const key = JSON.stringify(["hook-bundle", root, path.relative(lexicalRoot, entry), target, digest])
		const file = await grantsPath()
		const grants = await readGrants(file)
		if (!HostProvider.get().isWorkspaceTrusted()) return undefined
		if (grants.includes(key)) return { files, entry: bundlePath, digest, target }

		if (process.env[SKIP_APPROVAL_ENV] === "true") {
			await atomicWriteFile(file, JSON.stringify([...grants, key]))
			return { files, entry: bundlePath, digest, target }
		}

		if (!prompt || HostProvider.get().diracType !== "extension") return undefined
		const [grantRoot, relative, resolvedTarget] = JSON.parse(key) as string[]
		const decision = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Trust workspace hooks: ${relative}?`,
			options: {
				modal: true,
				items: [REVIEW, APPROVE],
				detail:
					`Workspace: ${grantRoot}\nResolved target: ${resolvedTarget}\nSHA-256: ${digest}\n` +
					`Files: ${[...files.keys()].join(", ")}\n` +
					`Only the exact bytes of this bundle will be trusted. Review the code before approving.`,
			},
		})
		if (decision.selectedOption === REVIEW) {
			await HostProvider.window.showTextDocument({ path: target })
			return undefined
		}
		if (decision.selectedOption !== APPROVE) return undefined
		// A checkout may have changed while the modal was open. Never grant approval for unseen bytes.
		const current = await readHookBundle(hooksDir)
		if (current.digest !== digest) return undefined
		await atomicWriteFile(file, JSON.stringify([...grants, key]))
		return { files: current.files, entry: bundlePath, digest, target }
	})
}

/** Reading the candidate never evaluates code. Interactive approval is only offered when explicitly requested. */
export async function approvedWorkspaceCode(
	workspaceRoot: string,
	entrypoint: string,
	manifest?: string,
	prompt = false,
): Promise<WorkspaceCodeSnapshot | undefined> {
	return approvalMutex.withLock(async () => {
		const { key, snapshot } = await fingerprint(workspaceRoot, entrypoint, manifest)
		const file = await grantsPath()
		const grants = await readGrants(file)
		if (!HostProvider.get().isWorkspaceTrusted()) return undefined
		if (grants.includes(key)) return snapshot
		if (!prompt || HostProvider.get().diracType !== "extension") return undefined
		const [root, relative, target, digest] = JSON.parse(key) as string[]
		const decision = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Trust workspace code: ${relative}?`,
			options: {
				modal: true,
				items: [REVIEW, APPROVE],
				detail: `Workspace: ${root}\nResolved target: ${target}\nSHA-256: ${digest}\nOnly these exact file contents will be trusted. Review the code before approving.`,
			},
		})
		if (decision.selectedOption === REVIEW) {
			await HostProvider.window.showTextDocument({ path: target })
			return undefined
		}
		if (decision.selectedOption !== APPROVE) return undefined
		// A checkout may have changed while the modal was open. Never grant approval for unseen bytes.
		const current = await fingerprint(workspaceRoot, entrypoint, manifest)
		if (current.key !== key) return undefined
		await atomicWriteFile(file, JSON.stringify([...grants, key]))
		return current.snapshot
	})
}

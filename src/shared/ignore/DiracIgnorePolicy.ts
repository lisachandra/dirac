import fs from "node:fs/promises"
import * as path from "node:path"
import ignore, { type Ignore } from "ignore"
import { Logger } from "../services/Logger"

export const DEFAULT_IGNORE_PATTERNS = [
	// Version control
	".git",
	".svn",
	".hg",
	".fslckout",
	"_fslckout",
	".bzr",
	"_darcs",
	".fossil-settings",

	// Dependencies
	"node_modules",
	"bower_components",
	"jspm_packages",
	"vendor",
	".cache",
	"__pycache__",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".venv",
	"venv",
	"env",
	".env",
	".yarn",

	// Build & Output
	"dist",
	"build",
	"out",
	"target",
	"bin",
	"obj",
	"gen",
	"CMakeFiles",
	".gradle",
	".turbo",
	".next",
	".nuxt",
	".svelte-kit",
	"coverage",
	".nyc_output",
	"__snapshots__",

	// IDEs
	".idea",
	".vs",
	".vscode",
	"*.egg-info",
	"*.suo",
	"*.user",
	"*.userosscache",
	"*.sln.doccache",
	"*.ncb",

	// OS files
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",

	// Binaries & Archives
	"*.vsix",
	"*.zip",
	"*.tar",
	"*.tar.gz",
	"*.tgz",
	"*.tar.bz2",
	"*.tar.xz",
	"*.gz",
	"*.jar",
	"*.war",
	"*.ear",
	"*.exe",
	"*.dll",
	"*.so",
	"*.dylib",
	"*.a",
	"*.o",
	"*.obj",
	"*.class",
	"*.pyc",
	"*.pyo",
	"*.wasm",
	"*.bin",
	"*.dat",
	"*.db",
	"*.sqlite",
	"*.sqlite3",
	"*.pdb",

	// Locks & Metadata
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"Gemfile.lock",
	"Cargo.lock",
	"composer.lock",
	"poetry.lock",
	"Pipfile.lock",
	"bun.lockb",

	// Misc
	"*.min.js",
	"*.min.css",
	"*.map",
]

export const INCLUDE_PREFIX = "!include "

export interface ParsedDiracIgnoreContent {
	content: string
	includedPaths: ReadonlySet<string>
}

interface ResolvedIgnoreLine {
	content: string
	includedPath: string | null
}

export async function parseDiracIgnoreContent(content: string, cwd: string): Promise<ParsedDiracIgnoreContent> {
	if (!content.includes(INCLUDE_PREFIX)) return { content, includedPaths: new Set() }

	const resolvedLines = await Promise.all(content.split(/\r?\n/).map((line) => resolveIgnoreLine(line, cwd)))
	return {
		content: resolvedLines.map((line) => line.content).join("\n"),
		includedPaths: new Set(resolvedLines.flatMap((line) => (line.includedPath ? [line.includedPath] : []))),
	}
}

async function resolveIgnoreLine(line: string, cwd: string): Promise<ResolvedIgnoreLine> {
	const trimmedLine = line.trim()
	if (!trimmedLine.startsWith(INCLUDE_PREFIX)) return { content: line, includedPath: null }

	const includePath = trimmedLine.substring(INCLUDE_PREFIX.length).trim()
	const resolvedIncludePath = path.resolve(cwd, includePath)
	try {
		return { content: await fs.readFile(resolvedIncludePath, "utf8"), includedPath: resolvedIncludePath }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		Logger.debug(`[DiracIgnore] Included file not found: ${resolvedIncludePath}`)
		return { content: "", includedPath: resolvedIncludePath }
	}
}

export class DiracIgnorePolicy {
	private matcher: Ignore = createMatcher()
	private controlPaths = new Set<string>()
	private contentInternal: string | undefined

	public constructor(private readonly cwd: string) {
		this.controlPaths.add(path.join(cwd, ".diracignore"))
	}

	public get content(): string | undefined {
		return this.contentInternal
	}

	public async reload(): Promise<void> {
		this.matcher = createMatcher()
		const ignorePath = path.join(this.cwd, ".diracignore")
		this.controlPaths = new Set([ignorePath])

		let content: string
		try {
			content = await fs.readFile(ignorePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			this.contentInternal = undefined
			return
		}

		const parsed = await parseDiracIgnoreContent(content, this.cwd)
		this.contentInternal = content
		this.matcher.add(parsed.content)
		this.matcher.add(".diracignore")
		for (const includedPath of parsed.includedPaths) this.controlPaths.add(path.normalize(includedPath))
	}

	public allowsRelativePath(relativePath: string): boolean {
		const normalizedPath = path.normalize(relativePath.replace(/[\\/]+/g, path.sep))
		if (!normalizedPath || normalizedPath === ".") return true
		if (normalizedPath === ".." || normalizedPath.startsWith(`..${path.sep}`) || path.isAbsolute(normalizedPath)) return true
		return !this.matcher.ignores(normalizedPath.split(path.sep).join("/"))
	}

	public allowsAbsolutePath(absolutePath: string): boolean {
		return this.allowsRelativePath(path.relative(this.cwd, path.resolve(this.cwd, absolutePath)))
	}

	public isControlPath(absolutePath: string): boolean {
		return this.controlPaths.has(path.normalize(absolutePath))
	}

	public getControlPaths(): ReadonlySet<string> {
		return new Set(this.controlPaths)
	}
}

function createMatcher(): Ignore {
	return ignore().add(DEFAULT_IGNORE_PATTERNS)
}

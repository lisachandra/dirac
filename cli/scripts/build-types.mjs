import { execSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

// Declaration build is best-effort (the runtime bundle is the deliverable);
// the previous Unix script also continued when tsc failed.
try {
	execSync("npx tsc -p tsconfig.lib.json", { stdio: "inherit" })
} catch {
	// Fall through and copy whatever declarations were produced.
}

const dist = resolve("dist")
const agentDir = resolve(dist, "agent")
mkdirSync(agentDir, { recursive: true })

function safeCopy(src, dest) {
	if (existsSync(src)) {
		cpSync(src, dest)
	}
}

safeCopy(resolve(dist, "types/cli/src/exports.d.ts"), resolve(dist, "lib.d.ts"))
safeCopy(resolve(dist, "types/cli/src/agent/DiracAgent.d.ts"), resolve(agentDir, "DiracAgent.d.ts"))
safeCopy(resolve(dist, "types/cli/src/agent/DiracSessionEmitter.d.ts"), resolve(agentDir, "DiracSessionEmitter.d.ts"))
safeCopy(resolve(dist, "types/cli/src/agent/public-types.d.ts"), resolve(agentDir, "public-types.d.ts"))
rmSync(resolve(dist, "types"), { recursive: true, force: true })

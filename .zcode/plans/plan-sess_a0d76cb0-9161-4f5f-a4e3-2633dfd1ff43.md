## Fix: recover from corrupted log lock files instead of crashing

Safe for running sessions: the change is purely additive recovery logic and only touches stale `.lock` directories inside the log dir (never task/session data, and never locks held by live processes).

### Root cause
`readLockOwner` in `src/shared/services/file-logger.ts` rethrows `JSON.parse`'s `SyntaxError` when a leftover lock directory contains an empty/torn `owner.json` (a prior process was hard-killed between `mkdirSync` and `writeFileSync`). Because the crash prevents cleanup, every later `dirac` invocation fails at startup. The sibling ACP lock already handles this via an `instanceof SyntaxError` guard (`cli/src/acp/acp-session-updates.ts`), demonstrating the intended pattern.

### Change 1 (the actual fix) — `src/shared/services/file-logger.ts`, `readLockOwner` (lines 475-485)
Treat an unreadable `owner.json` as "no known owner" instead of throwing:
- In the existing catch, also swallow `SyntaxError` (any JSON parse failure) and return `undefined`, matching the guard used in `acp-session-updates.ts`.
- Only the `removeStaleLock` path reads an old lock, and it already requires the directory to be older than `STALE_LOCK_AGE_MS` (60s) before parsing. Returning `undefined` makes it fall through to `fs.rmSync`, removing the dead orphan and letting startup proceed.
- `releaseLockSync` (the other caller) reads the owner of the lock we hold; a corrupt owner there means the token won't match and the dir is skipped. That leaked dir then self-heals on a later run via the tolerant `removeStaleLock` — no behavioral risk, since a live holder always has a valid owner file.

### Change 2 (optional hardening) — `acquireLockSync` in the same file
Write `owner.json` with the existing `writePrivateFileAtomically` (temp file + atomic `renameSync`) instead of `fs.writeFileSync`. A hard-kill could then never leave a half-written `owner.json`; the only possible leftover becomes a lock dir with no owner file, which the existing `ENOENT` path already cleans up. Two lines, prevents recurrence. I'll include it unless you'd rather keep the diff strictly minimal.

### Change 3 — regression test in `src/shared/services/__tests__/file-logger.test.ts`
Following the file's mocha/temp-dir conventions (backdating mtime with `fs.utimesSync`, as the existing 14-day prune test does):
- Plant stale lock directories containing a corrupt `owner.json` — one empty (0 bytes), one torn (`{pid:`) — backdated > 60s.
- Assert `prepareLogDirectory(logDir)` does not throw and the leftover `.lock` directories are removed.

### Verification
- Run the file-logger tests: `npm test -- src/shared/services/__tests__/file-logger.test.ts`.
- `npm run compile` to confirm the build.

Notes: no changes to lock design, log rotation/content, task storage, or CLI ordering. Running agents are unaffected (old in-memory code; no restart required). The fix only takes effect for new processes after the CLI is rebuilt.
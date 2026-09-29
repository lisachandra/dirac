# ACP Response-Cutoff Investigation — Findings

Date: 2026-09-23
Scope: Dirac CLI ↔ Paseo over ACP; sessions `93b9d2da` (dirac repo), `22475c39` (rbxts repo), plus the original cutoff-report session.

---

## TL;DR

1. **Nothing is corrupted.** Byte-for-byte comparison of Dirac's ACP journal vs Paseo's timeline shows every chunked message arrived intact in both sessions audited.
2. **The original "cut off" was a transport-ordering race** in Dirac's ACP layer: the `session/prompt` `end_turn` response could overtake the final `agent_message_chunk` (Task Completed / Proposed Plan), and Paseo closed the turn before the tail arrived.
3. **The fixes are already in the working tree** (uncommitted), but **the installed CLI binary was stale** (built 2026-09-20, before the fixes) — that's why truncation kept happening at runtime. The binary has now been rebuilt with the fixes.
4. **The "truncated prompt" impression in session `22475c39` was inbound, not outbound**: the `<chat-history-summary>` that Paseo injected into the prompt was itself cut off mid-sentence by Paseo's summary generation (during a stretch of provider API failures), so the model correctly reasoned that its task text was incomplete.

---

## 1. Evidence audit (data, not theory)

### Sources compared
- Dirac journal: `~/.dirac/data/acp-session-updates/<sha256(sessionId)>.jsonl` (written by `cli/src/acp/acp-session-updates.ts`, one line per update, `_meta` carries `dev.dirac/seq`).
- Paseo timeline: `~/.paseo/timelines/<agentId>.json` (rows keyed by `seq`; `assistant_message` items carry `messageId`).

### Session `93b9d2da-…` (dirac session `11a2b190-…`)
- The 3,845-char completion summary ("Why `complete`/`plan` sometimes looks cut off over ACP in Paseo: …") exists in the journal as a single `agent_message_chunk` (journal line 497, `sequenceNumber` 498).
- Paseo's timeline stores the same text under `messageId: 8cc1ed88-e4a6-4e74-9848-931c7acf29ef`.
- **Result: byte-for-byte identical (3,845 == 3,845). No truncation.**
- The session tail is a cascade of `API Error (attempt 1/3). Cancelled` tool_call cards — provider (glm/muse via local proxy) failures, **not** transport truncation. The repeated "Retrying API request..." rows are the provider retry loop, which is also what truncated the *next* session's chat-history-summary.

### Session `22475c39-…` (rbxts, dirac session `d5117c14-…`)
- 8 distinct `agent_message_chunk` messageIds in the journal; all 8 **identical** in Paseo's timeline (including the 112-char intro, the 88-char wrap-up, and the hook-cancel notices).
- The journal's `user_message_chunk` is **48,700 chars** — the full prompt including `<chat-history-summary>` arrived intact at Dirac. The 155-char user message shown in Paseo's timeline is just the typed text; the summary is client-side context, expected to differ.
- The model's reasoning ("the task text mentions 'Should we note our changes in DIVER…' — incomplete") is accurate: **the summary Paseo generated was cut mid-sentence** (`Source agent: Should we note our changes in DIVERGENCES for the ported packages and how can w…`). That truncation happened at summary-generation time on the Paseo side during the API-failure storm, before the prompt was ever sent.

---

## 2. Root cause of the original outbound cutoff (now fixed in source)

Path: `CompletionResponseOperation` / `PlanResponseOperation` → Dirac card → `messageTranslator.translateCardMessage` → `agent_message_chunk` → `AcpAgent` forward → stdio → Paseo `admitPrompt` marks the turn completed on the prompt response.

The race:
1. `AcpAgent.forwardSessionUpdate` used to call `connection.sessionUpdate(...).catch(log)` fire-and-forget.
2. `DiracAgent.emitSessionUpdate` only awaited journal persist + sync `emitter.emit()` — not the actual stdio flush.
3. `TaskMessageBridge.processMessageWithDelta`'s `await emit(...)` therefore returned before bytes hit stdout, then `checkMessageForPromptResolution` resolved `prompt({stopReason:"end_turn"})`.
4. The `session/prompt` response overtook the final chunk; Paseo (`AcpRuntime.admitPrompt`) closed the turn → tail of Task Completed / Proposed Plan looked truncated/missing.

Aggravators (also fixed in the working tree):
- Completion/plan chunks had **no `messageId`** → Paseo's `reduceUpdate` fell back to a per-chunk sequence id, so no accumulation, and `compactSessionUpdatesForReplay`'s `mergeStreamedChunks` could merge unrelated `null==null` chunks on replay ("cut off then duplicated").
- `DiracSessionEmitter` replayed only `lastPayload` per event to late subscribers — a new `agent_message_chunk` subscriber got the tail only.

### Fixes present in the working tree (uncommitted, verified by `git diff`)

| File | Fix |
|---|---|
| `cli/src/acp/AcpAgent.ts` | Per-session FIFO lane (`enqueueSessionForward`); `prompt()` awaits `drainSessionForwards()` before returning the response; `flushSessionForwards()` for tests/shutdown; lanes cleaned up per session/disconnect. |
| `cli/src/agent/messageTranslator.ts` | `messageId: message.id` on completion/plan/followup `agent_message_chunk`s. |
| `cli/src/acp/acp-session-updates.ts` | `mergeStreamedChunks` refuses to merge chunks whose `messageId` is `null`. |
| `cli/src/agent/DiracSessionEmitter.ts` | `REPLAYABLE_EVENTS` whitelist — only snapshot kinds (`config_option_update`, `current_mode_update`, `session_info_update`, `available_commands_update`, `usage_update`) are cached/replayed; streaming chunks never replayed. |
| `cli/src/agent/taskMessageBridge.ts` | Invalidated interactions (cancelled turn / dismissed form) now `submitCardResponse(REJECT)` the parked card so tools finalize. |
| `cli/src/agent/DiracAgent.ts` + `DiracAgent.continuity.test.ts` | Timed-out `cancelTask()` no longer marks `awaitingCancelledTaskResume`; follow-up prompts rehydrate persisted history instead of discarding it; `withTimeout` uses a distinct sentinel. |

### The stale-binary gap (why it kept happening)

- `C:\Users\PC\.local\bin\dirac(.cmd)` execs `D:/Github/Other/dirac/cli/dist/cli.mjs`.
- That bundle was built **2026-09-20 12:48** and contained **neither** `enqueueSessionForward` **nor** `drainSessionForwards` — i.e. Paseo was running the pre-fix transport the whole time.
- **Action taken:** rebuilt via `cd cli && npm run build` (2026-09-23 13:57 UTC). `cli/dist/cli.mjs` now contains both symbols; `dirac --version` still reports 0.4.35. **Paseo sessions must be restarted to spawn the new binary.**

---

## 3. Why "the prompt was truncated" earlier — resolved

Two separate things were conflated:

1. **Outbound truncation (real, now fixed):** the completion/plan tail race described above.
2. **Inbound "truncation" (not a Dirac bug):** in the rbxts session, the `<chat-history-summary>` block inside the prompt was cut off at generation time by Paseo (during the provider-failure storm). Dirac received all 48,700 chars; the model simply couldn't find a complete task because the summary itself was incomplete. My earlier suspicion that Dirac truncated the inbound prompt was wrong.

---

## 4. Remaining recommendations

1. **Restart Paseo / relaunch ACP sessions** so the rebuilt `cli/dist/cli.mjs` is actually used. Until then, symptoms may persist despite the fixed source.
2. **Commit the working-tree fixes** — they are the actual resolution for the cutoff report. Suggested split:
   - `fix(acp): flush pending session updates before resolving prompt` (AcpAgent, DiracSessionEmitter)
   - `fix(acp): stable messageId for completion/plan chunks + replay merge guard` (messageTranslator, acp-session-updates)
   - `fix(acp): resolve parked cards when interactions are invalidated` (taskMessageBridge)
   - `fix(agent): rehydrate cancelled tasks instead of discarding history` (DiracAgent + continuity test)
3. **Optional regression tests to add** (not yet present):
   - Large `TASK_COMPLETED` / `Proposed Plan` → assert the `agent_message_chunk` is flushed before the prompt response resolves (`flushSessionForwards` already exposed for this).
   - `compactSessionUpdatesForReplay` must not merge two `agent_message_chunk`s with `messageId: null`.
   - Paseo-side `reduceUpdate` reassembles full text when a stable `messageId` is present (belongs in the paseo repo).
4. **Paseo-side (their repo):** chat-history-summary generation can truncate mid-line under provider failures; consider suffixing an explicit `[summary truncated]` marker or retrying summary generation, so agents stop misreading it as a transport cutoff.

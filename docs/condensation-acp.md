# `/smol` condensation over ACP

How user-requested condensation (`/smol`, `/compact`) behaves for ACP clients such as Paseo, and what each layer owns.

## Interaction contract

1. `/smol` reaches Dirac as ordinary prompt text (`cliCompatible: true`, not in `CLI_ONLY_COMMANDS`).
2. A user-requested condensation always asks before changing conversation state. The ask is a card with
   `requireApproval: true`, header `Condense Conversation`, actions `Condense` / `Cancel`.
   - Utility path (`directAction: { type: "condenseConversation" }`): `LocalConversationCompaction.run({ source: "user" })`
     asks first, then reuses the approval card as progress (`Condensing Conversation · <provider/model>`) and result
     (`Conversation Condensed · <provider/model>`) card.
   - Model path (no Utility model for condensation): the expanded prompt makes the active model call the `condense`
     tool, and `CondenseTool.requestUserApproval` raises the same card shape.
3. Automatic condensation (`source: "automatic"`) and autonomous sessions (`yoloModeToggled`) skip the ask.
4. A declined or failed condensation reports `unavailable` / `cancelled` / `failed` and the turn ends with visible
   text (`directResponseText`). The conversation is untouched.

## ACP rendering

`cli/src/agent/messageTranslator.ts` is the only layer that knows ACP.

- `toolNameForCard` maps condensation headers to the tool name `condense`, which `TOOL_KIND_MAP` renders as kind
  `think`. Without it the card surfaced as an unlabeled `other` tool.
- The approval card body must be set in the `createCard` call: ACP clients snapshot the tool call when they raise
  `session/request_permission`, so a body attached by a later `update` renders blank.
- `WAITING_FOR_INPUT` + `requireApproval` is what `taskMessageBridge` converts into `session/request_permission`;
  `allow_once` / `reject_once` convert back into `submitCardResponse`. No new ACP method is involved.

## Failure modes this prevents

- An approval card nothing answers never resolves `session/prompt`, so the session looks hung.
- A card left `RUNNING` after a cancelled turn surfaces as `Tool 'condense' did not finalize card(s)`.
- A completed compaction without a continuation still needs a terminal signal, otherwise the ACP turn parks with no
  card and no text.

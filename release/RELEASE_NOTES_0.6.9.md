# dsh-cursor-subscription v0.6.9

One document for three versions. The registry has `v0.6.6`; `v0.6.7` and
`v0.6.8` were prepared together with this one and were never published on their
own, so upgrading from `v0.6.6` brings everything below in a single restart.

## v0.6.9 — DSH 0.1.7 compatibility, compaction, honest usage

DSH 0.1.7-alpha.1 replaced the settings service this plugin was built against.
`apply` called `ctx.get("settings").installSection(...)`, the method no longer
existed, and the `cursor-subscription` entry failed to activate on every boot:

```text
cursor-subscription (dsh-cursor-subscription):
TypeError: ctx.get(...).installSection is not a function
```

The same session records showed two more defects on the Cursor path: a run kept
the transcript DSH had just compacted away, and the adapter reported placeholder
token counts.

### Root cause

Three separate contracts had drifted.

**The settings API.** DSH 0.1.7 composes a plugin's settings page from its own
profile entry: the entry id is the namespace, only fields marked `.volatile()`
appear, the Loader delivers those as live references (`config.x.get()`) that it
updates in place, and `settings.configure({ auto }, fiber)` states the page
policy. `installSection` and `settings.register` — the section-registration pair
this build was written against — are gone. A Config without a volatile field
produces no section at all, and `.volatile()` itself first exists in
`@deepseek-ai/schemastery` 3.18.3, which this plugin declared as a peer under a
range that still allowed 3.18.1.

**Compaction.** DSH frees context by replacing a span of the conversation with a
summary and marking that message `source.kind = "compact-checkpoint"` with the
id of the compaction. The adapter preferred its own persisted Cursor checkpoint
whenever one existed, and that checkpoint still described the pre-compaction
transcript: in the failing session DSH had condensed the history to ~2.4k tokens
while the model kept running on ~204k tokens of history DSH had already dropped.
The run re-planned the same investigation step after step — 22 steps, one search
each, no file ever edited — until the user aborted it.

**Usage.** `inputTokens` was hardcoded to `0`, and `outputTokens` kept the last
`token_delta` frame instead of summing the deltas, so a full paragraph was
reported as 1–3 tokens.

### Fixed

**The settings section follows the DSH 0.1.7 API.** `Config` fields are now
`.volatile()`, `readConfigField()` reads a field that may be either a live
reference or a plain value, and `apply` states the page policy through
`ctx.inject(["settings"], ...)` → `settings.configure({ auto: false }, ctx.fiber)`:
this plugin ships its own **Settings → Cursor** panel, so the generated form
stays off. On a DSH release without `configure` (the 0.1.5 line) the Cursor
provider still loads and only the settings page stays empty, instead of failing
the whole entry at boot.

**`@deepseek-ai/schemastery` is a runtime dependency.** It moved from
`peerDependencies` to `dependencies` (`^3.18.3`), the way DSH's own plugins
declare it, so an install carries the library version that has `.volatile()` and
a stale shared `node_modules` tree can no longer decide which library parses the
plugin's Config.

**A compaction drops the checkpoint it invalidates.** `compactionIdOf()` reads
the compaction id out of the message history. When it differs from the id the
persisted Cursor conversation was built from, the adapter drops the checkpoint
and its blobs and refuses to resume a live bridge across it, so the next cold
start is rebuilt from what DSH kept.

**Usage reports the real prompt size and the whole output.** The prompt size
Cursor reports rides in the conversation checkpoint
(`ConversationStateStructure.token_details.used_tokens`) and is now decoded by
`decodeCheckpointUsedTokens()`; output tokens are summed from the `token_delta`
frames.

## v0.6.8 — a tool request this build cannot name is still answered

A Cursor turn that needed a tool could end right after the model said what it
was about to do — "I'll read that file" — with nothing actually happening. The
model had asked Cursor for one of its built-in tools, this build did not
recognize the request, and because nothing answered it the server waited for a
result that never came: the progress watchdog fired 60 seconds later and only
the preamble text survived into the conversation.

**An exec this build cannot name is still answered.** `ExecServerMessage`
carries Cursor's tool requests. This build decodes the variants it knows (read,
ls, grep, write, delete, shell, fetch, diagnostics, …), rejects each one with a
message telling the model to use the DSH tools instead, and forwards MCP calls
(`mcp_args`) as real DSH tool calls. Cursor adds exec variants without notice:
this cycle it sent an exec whose args field is **36** — a message carrying only
a workspace name, for a tool this build has no name for.
`decodeExecServerMessage` returned `{ case: "unknown" }`, `rejectionFor()`
returned `undefined` for it, and the adapter wrote no reply at all.
`ExecClientMessage` numbers its result variants exactly like
`ExecServerMessage` numbers its exec variants, so an unnameable exec is now
answered on its own field with the generic error shape
`{ error = 2 { error = 1 } }`, carrying the same reason the other native tools
get ("Tool not available in this environment. Use the MCP tools provided
instead."). Field 19 (`span_context`) is a plain non-oneof field, so it is never
mistaken for the exec; a message that carries only ids and a span context has no
exec to answer and is left alone. The adapter logs one warning per run naming the
field it declined, and a second if an exec arrives with no addressable field
(the one case that can still stall).

**The stall trace names the field.** `decodeExecServerMessage` keeps the field
number of an unknown exec and the message's top-level fields, and the stall
trace prints `exec:unknown#36[1,19,36,55]` instead of the bare `exec:unknown`
that made this hard to diagnose from the log alone.

## v0.6.7 — the model list is sorted by name

Cursor's `GetUsableModels` answers in its own order — newest family first — and
the plugin passed that order straight through, so the DSH model picker and the
settings model list rendered 231 entries for a live account in Cursor's
sequence: `Auto` buried at the top, `Claude Fable`, then `Claude Opus`, then
whatever Cursor had added most recently. The order also moved between Cursor
releases, so the list reshuffled on its own.

- `CursorAdapter.#discoverModels` sorts the list it projects from
  `GetUsableModels` (and from the offline fallback list) before caching it, so
  every surface that reads the cache inherits one order: `listModels` for the
  DSH picker and `listModelsForRpc` for the settings list can no longer
  disagree.
- Names are compared with `Intl.Collator("en", { numeric: true, sensitivity:
  "base" })`, and the id breaks ties:
  - the collation is pinned to `"en"` rather than the host locale, so one build
    lists the same order everywhere and the picker does not depend on the
    reader's language;
  - `numeric` keeps families in their natural sequence — `Composer 1.5` before
    `Composer 2`, `GPT-5` before `GPT-5.1` before `GPT-10` — instead of
    comparing the digits as text;
  - `sensitivity: "base"` makes the order case-insensitive, so `auto`, `Auto`,
    and `GPT-4o` / `gpt-4o` neighbours stay together;
  - two models that share a display name (Cursor returns several variants that
    do) are ordered by id, so the list stays stable instead of depending on
    response order.
- `sortModelsByName(models)` is exported for callers outside the adapter. It
  returns a copy, so a caller holding the cached list never has it reordered
  underneath.
- The hardcoded fallback list, previously written in family order, is sorted by
  the same rule.
- **What did not change:** which models are listed and their metadata — same
  ids, same names, same `inputModalities`, same cache lifetime (5 minutes).
  `resolveModel` still resolves by id, so a model selected before the upgrade
  keeps working. The usage card's included-usage table still sorts model rows by
  spend, the way Cursor's dashboard does; only the selectable model list is
  name-ordered.

## Verification

- **v0.6.9, live after the API migration:** `dsh web` boots with the entry
  active — the loopback channel answers `POST /cursor-subscription/version` with
  Connection's `401 unauthorized`, which only happens once `apply` has completed
  and mounted the route. A three-step Cursor run then reported `inputTokens`
  17,613 / 17,544 / 18,558 and `outputTokens` 390 / 237 / 5: prompt sizes that
  grow with the conversation, and an output count that matches the text.
- **v0.6.9, compaction:** in the failing session the live history after
  condensing was 9,641 characters (~2,410 tokens) while the full session was
  815,800 characters (~203,950 tokens, 55% of it tool output).
- **v0.6.9, real-cordis boot probe:** 12/12 — the entry activates against a
  0.1.7-shaped settings service, the page policy is keyed by the plugin's own
  fiber, `Config` arrives as live references, a committed edit is visible on the
  next read, the settings update path writes through the entry namespace, and a
  0.1.5-shaped service still loads the provider.
- **v0.6.8, live reproduction:** the two prompts below stalled and produced no
  tool call before the fix — the step ended with only the preamble text.

  | prompt | before | after |
  | --- | --- | --- |
  | read and summarise `package.json` | stall, no tool call | MCP `read` call at 9.5s |
  | read the first paragraph of `README.md` | stall, no tool call | MCP `read` call at 11.5s |

  Same result with `claude-opus-5-high`, the model in the failing session: the
  unknown exec is declined at 4.7s and the MCP `read` call arrives at 11.5s.
- **v0.6.8, reply shape probed against the live server:** with no reply the run
  stalls (7 frames, heartbeats only). Replying on the exec's own field resumes it
  — empty payload, `{ success = 1 }`, `{ error = 2 { error = 1 } }`, and
  `{ rejected = 3 }` all continue the run, and the server then reports
  `toolCallCompleted`. Replying on field 11 (`mcp_result`) instead stalls, which
  is why the reply must use the exec's own number.
- **v0.6.7, live:** with the stored account the adapter lists 231 models with 0
  adjacent order violations under the collator, `listModels` and
  `listModelsForRpc({ force: true })` return the identical id order, and
  re-sorting the returned list is a no-op. The list now runs `Auto`,
  `Claude Fable 5 1M (NO ZDR)`, … `Muse Spark 1.3 1M Minimal`.
- **Unit:** 96 host-side tests pass, up from 88 at `v0.6.6`. New cases across the
  three versions: names sort case-insensitively with numbers in natural order,
  equal names fall back to the id, the input array is left untouched, the
  adapter's picker list and RPC list agree, and the fallback list comes out in
  its expected name order (0.6.7); an unknown exec keeps field 36 and its
  top-level field list, the reply uses that field and decodes to the reject
  reason, a message with only ids and a span context is not answered on field 19,
  every outright-rejected exec answers on its own field number, and the adapter
  answers an unknown exec once, warns the operator, and keeps streaming until
  `turn_ended` (0.6.8); a checkpoint captured before a compaction is not reused,
  a step's token total is the sum of its deltas, and `resolveCursorSettings`
  reads live volatile references (0.6.9).

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.9
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.9`.

Upgrading straight from `v0.6.6` also brings the name-sorted model list described
under v0.6.7, and from `v0.6.5` or earlier the dashboard-shaped included-usage
table described in the v0.6.6 notes.

## Compatibility and known notes

- The settings page needs a DSH release whose settings service has `configure`
  (0.1.7-alpha.1 and later). Everything else — login, model discovery, chat, tool
  calls — still works on the 0.1.5 line.
- `@deepseek-ai/schemastery` is a runtime dependency now: a profile install
  carries its own copy, so a stale shared `node_modules` tree can no longer
  decide which library the plugin parses its Config with.
- Cursor's native tools stay declined, one call at a time: a model that tries one
  pays a rejected round trip before falling back to the DSH tools, and such
  declines are not counted against the tool-round limit. An exec this build
  cannot name is declined the same way, never implemented. A server exec with no
  addressable field still cannot be answered; that case now logs a warning naming
  it instead of failing silently.
- A system prompt note stating up front that Cursor's native tools are
  unavailable was measured over two sessions and did not reduce the detour
  (14/21 and 15/19 steps still contained it; average step 39.6s before, 55.7s
  after), so it is not shipped.
- A long session that DSH compacts can still leave the model re-investigating its
  own earlier work. What this release guarantees is that it re-investigates the
  compacted history rather than the one DSH already dropped.
- `sortModelsByName(models)` is an export added in v0.6.7.
  `CursorAdapter.listModels` and `listModelsForRpc` keep their signatures and now
  always return a name-sorted array. Model ids are unchanged, so a pinned model
  id still resolves. Cursor's `GetUsableModels` response order is not documented
  and can change at any time; the picker no longer depends on it.
- Cursor's Agent protocol stays undocumented and keeps growing; the stall trace
  records the field numbers needed to extend the decoder.

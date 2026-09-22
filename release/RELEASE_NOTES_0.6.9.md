# dsh-cursor-subscription v0.6.9

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

## Root cause

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
transcript: in the failing session DSH had condensed the history to ~2.4k
tokens while the model kept running on ~204k tokens of history DSH had already
dropped. The run re-planned the same investigation step after step — 22 steps,
one search each, no file ever edited — until the user aborted it.

**Usage.** `inputTokens` was hardcoded to `0`, and `outputTokens` kept the last
`token_delta` frame instead of summing the deltas, so a full paragraph was
reported as 1–3 tokens.

## Fixed

### The settings section follows the DSH 0.1.7 API

`Config` fields are now `.volatile()`, `readConfigField()` reads a field that may
be either a live reference or a plain value, and `apply` states the page policy
through `ctx.inject(["settings"], ...)` →
`settings.configure({ auto: false }, ctx.fiber)`: this plugin ships its own
**Settings → Cursor** panel, so the generated form stays off. On a DSH release
without `configure` (the 0.1.5 line) the Cursor provider still loads and only the
settings page stays empty, instead of failing the whole entry at boot.

`@deepseek-ai/schemastery` moved from `peerDependencies` to `dependencies`
(`^3.18.3`), the way DSH's own plugins declare it, so an install carries the
library version that has `.volatile()`.

### A compaction drops the checkpoint it invalidates

`compactionIdOf()` reads the compaction id out of the message history. When it
differs from the id the persisted Cursor conversation was built from, the adapter
drops the checkpoint and its blobs and refuses to resume a live bridge across it,
so the next cold start is rebuilt from what DSH kept.

### Usage reports the real prompt size and the whole output

The prompt size Cursor reports rides in the conversation checkpoint
(`ConversationStateStructure.token_details.used_tokens`) and is now decoded by
`decodeCheckpointUsedTokens()`; output tokens are summed from the `token_delta`
frames.

## Verification

- **Live, after the API migration:** `dsh web` boots with the entry active — the
  loopback channel answers `POST /cursor-subscription/version` with Connection's
  `401 unauthorized`, which only happens once `apply` has completed and mounted
  the route. A three-step Cursor run then reported `inputTokens`
  17,613 / 17,544 / 18,558 and `outputTokens` 390 / 237 / 5: prompt sizes that
  grow with the conversation, and an output count that matches the text.
- **Compaction:** in the failing session the live history after condensing was
  9,641 characters (~2,410 tokens) while the full session was 815,800 characters
  (~203,950 tokens, 55% of it tool output).
- **Real-cordis boot probe:** 12/12 — the entry activates against a 0.1.7-shaped
  settings service, the page policy is keyed by the plugin's own fiber, `Config`
  arrives as live references, a committed edit is visible on the next read, the
  settings update path writes through the entry namespace, and a 0.1.5-shaped
  service still loads the provider.
- **Unit:** 96 host-side tests pass. New cases: a checkpoint captured before a
  compaction is not reused, a step's token total is the sum of its deltas, and
  `resolveCursorSettings` reads live volatile references.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.9
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.9`.

## Compatibility and known notes

- The settings page needs a DSH release whose settings service has `configure`
  (0.1.7-alpha.1 and later). Everything else — login, model discovery, chat, tool
  calls — still works on the 0.1.5 line.
- `@deepseek-ai/schemastery` is a runtime dependency now: a profile install
  carries its own copy, so a stale shared `node_modules` tree can no longer
  decide which library the plugin parses its Config with.
- Cursor's native tools stay declined one call at a time, and a model that tries
  one pays a rejected round trip before falling back to the DSH tools. A system
  prompt note stating that up front was measured over two sessions and did not
  reduce it (14/21 and 15/19 steps still contained the detour; average step
  39.6s before, 55.7s after), so it is not shipped.
- A long session that DSH compacts can still leave the model re-investigating
  its own earlier work. What this release guarantees is that it re-investigates
  the compacted history rather than the one DSH already dropped.

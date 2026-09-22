# dsh-cursor-subscription v0.6.7

The model list is sorted by name. Cursor's `GetUsableModels` answers in its own
order — newest family first — and the plugin passed that order straight
through, so the DSH model picker and the settings model list rendered 231
entries for a live account in Cursor's sequence: `Auto` buried at the top,
`Claude Fable`, then `Claude Opus`, then whatever Cursor had added most
recently. The order also moved between Cursor releases, so the list reshuffled
on its own.

## Fixed

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

## What did not change

- Nothing about which models are listed or their metadata: same ids, same
  names, same `inputModalities`, same cache lifetime (5 minutes).
- `resolveModel` still resolves by id, so a model selected before the upgrade
  keeps working.
- The usage card's included-usage table still sorts model rows by spend, the
  way Cursor's dashboard does; only the selectable model list is name-ordered.

## Verification

- **Live:** with the stored account the adapter lists 231 models with 0
  adjacent order violations under the collator, `listModels` and
  `listModelsForRpc({ force: true })` return the identical id order, and
  re-sorting the returned list is a no-op. The list now runs `Auto`,
  `Claude Fable 5 1M (NO ZDR)`, … `Muse Spark 1.3 1M Minimal`.
- **Unit:** 88 host-side tests pass (proto 55, client-locales 8,
  client-usage-table 4, inject-contract 6, version 6, native-fetch 6,
  image-input 3). New cases: names sort case-insensitively with numbers in
  natural order, equal names fall back to the id, the input array is left
  untouched, the adapter's picker list and RPC list agree, and the fallback
  list comes out in its expected name order.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.7
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.7`.

Upgrading from v0.6.5 or earlier also brings the dashboard-shaped
included-usage table described in the v0.6.6 notes.

## Compatibility and known notes

- `sortModelsByName(models)` is a new export. `CursorAdapter.listModels` and
  `listModelsForRpc` keep their signatures and now always return a name-sorted
  array.
- Model ids are unchanged; if you pinned a model id in configuration, it still
  resolves.
- Cursor's `GetUsableModels` response order is not documented and can change at
  any time; the picker no longer depends on it.

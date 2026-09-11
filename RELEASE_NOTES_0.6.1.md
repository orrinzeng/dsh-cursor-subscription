# dsh-cursor-subscription v0.6.1

The Cursor settings panel now reads in twelve languages, labels itself with the
build that is actually serving it, and starts cleanly on DSH 0.1.5-rc.1.

**Upgrade is required if DSH refuses to start with**
`dsh: plugin tree failed to load: failed to apply loader entry cursor-subscription (dsh-cursor-subscription): cannot get property "webServer" without inject` —
that failure is what this release fixes.

## Before installing: pnpm's 24-hour release-age gate

pnpm 11+ ships a built-in `minimumReleaseAge` of 24 hours, so a range such as
`^0.5.0` never selects a version published within the last day. Right after a
release, a plain `dsh plugin --profile web add dsh-cursor-subscription` resolves
to the newest release *older than 24 hours* — for this package's recent history,
the earliest published version rather than the one you just shipped. Either
request the exact version, or exempt the package by name in the profile's
`pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - dsh-cursor-subscription
```

The exemption keeps the gate active for every other package. See
[AGENTS.md](AGENTS.md) for the full install and verification procedure.

## Fixed

### Startup failure on DSH 0.1.5-rc.1 — `cannot get property "webServer" without inject`

- **Affected:** any 0.5.x build that mounted its account channel through
  `connection.rpc.handle`, on a DSH whose Connection plugin no longer declares
  `webServer` (0.1.5-rc.1). The failure took down the entire plugin tree, so DSH
  did not start at all.
- **Cause:** `HostConnectionService.register` reads `owner.webServer`, and
  `rpc.handle` binds `owner` to the Context that *reads* the Connection service,
  whose `webServer` resolves through the **providing** plugin's own scope.
  `@deepseek-ai/dsh-client-connection` 0.1.5-rc.1 declares `credentials` alone
  and mounts its own `/api` transport from a nested `webServer` Context, so that
  read throws for every out-of-tree consumer. Declaring `webServer` in this
  plugin's own `inject` cannot help — the failing read never happens on this
  plugin's Context.
- **Fix:** mount the channel by calling the same registry method Connection uses
  internally, with an explicit owner Context that declares `webServer`; the
  public `rpc.handle` stays as a fallback for a Connection plugin that declares
  `webServer` itself. The channel path, request envelope, Host/Origin trust
  fence, and browser authentication are unchanged, so the browser half needed no
  change at all.

## Added

### Twelve panel languages

The panel carried Simplified Chinese and English; it now also ships Traditional
Chinese, Japanese, Korean, Spanish, French, German, Italian, Brazilian
Portuguese, Russian, and Arabic.

| Locale | Label | Falls back to |
| --- | --- | --- |
| `zh-Hant` | 繁體中文 | `zh` |
| `ja` | 日本語 | `en` |
| `ko` | 한국어 | `en` |
| `es` | Español | `en` |
| `fr` | Français | `en` |
| `de` | Deutsch | `en` |
| `it` | Italiano | `en` |
| `pt-BR` | Português (Brasil) | `en` |
| `ru` | Русский | `en` |
| `ar` | العربية | `en` |

- Each contributed language is registered into DSH's shared locale catalog, so it
  appears in **Settings → General → Language**; everything outside the panel
  falls back to English.
- **Arabic mirrors the panel**: layout direction, progress bars, and row
  alignment flip, while numeric inputs and model identifiers stay
  left-to-right. The marker and the stylesheet rules are scoped to this panel,
  so the rest of the shell is untouched.
- Languages are contributed only where the DSH locale runtime supports language
  packs (`addLanguage`). On an older runtime the panel keeps working in zh/en
  instead of failing.

### Version label in the panel header

The section title now carries the version of the installed build (for example
`v0.6.1`). The number comes from the plugin's own manifest over the existing
account channel, so it is never duplicated into the browser bundle and cannot
drift from the published package. A failed lookup simply omits the label — it
never turns the panel into an error state.

## Changed

- **Copy is now test-enforced.** Every dictionary is checked against the English
  key set, its `{placeholders}`, and brace balance; the panel is checked for keys
  it reads but never defines and keys it defines but never reads. That check
  found four entries no component ever read (`usageError`, `spendUsed`,
  `planPercent`, `modelsEmpty`); they were removed rather than translated ten
  more times.
- **Lockfile refreshed.** `pnpm-lock.yaml` still recorded the pre-widening
  `0.1.0-rc.6` specifier for `@deepseek-ai/dsh-client-connection` while
  `package.json` declares `>=0.1.0-rc.6 <0.2.0`, which a frozen install refuses.
  All 14 peer specifiers now match the manifest.
- **Documentation.** Both readmes and [AGENTS.md](AGENTS.md) document the pnpm
  release-age gate, the contributed languages, and the version label.
- **Tests:** 70 in total — 41 agent-protocol, 8 panel-language contract,
  6 channel mount, 6 version label, 6 native fetch, 3 image input.

## Install or upgrade

```sh
# exact version (works regardless of the 24-hour gate)
dsh plugin --profile web add dsh-cursor-subscription@0.6.1

# or, once the release-age exemption above is in place
dsh plugin --profile web add dsh-cursor-subscription
dsh plugin --profile web update dsh-cursor-subscription

dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

Restart DSH manually afterwards (`patchReload` does not pick up new bundles or
client modules), then check:

1. **Settings → Cursor** loads, with `v0.6.1` next to the title.
2. **Settings → General → Language** lists the new languages; Arabic mirrors the
   panel.
3. `cursor-subscription` appears in the model picker, and sign-in plus usage and
   model cards work as before.

## Compatibility and known notes

- The account channel reuses Connection's envelope, trust fence, and browser
  authentication. On `@deepseek-ai/dsh-client-connection` 0.1.5-rc.1 the
  `authority: "loopback"` registry option no longer exists (it is honored on
  0.1.0-rc.6), so the channel inherits the same `/api` protections: loopback or
  declared trusted Hosts plus a signed browser session.
- Contributed panel languages need a DSH locale runtime with language-pack
  support; the panel degrades to Chinese/English elsewhere without an error.
- Arabic mirroring is scoped to this panel; DSH's own shell strings remain
  English for contributed languages, which is what the `en` fallback provides.
- Cursor's Agent protocol remains undocumented and changes over time; a
  transport or `CURSOR_ERROR` failure on the chat path is expected to need a
  plugin update.

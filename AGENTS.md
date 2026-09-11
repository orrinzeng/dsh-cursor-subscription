# Agent installation guide

Use this guide when a user asks an Agent to install, update, verify, or remove
`dsh-cursor-subscription`.

## Safety

- Confirm the target DSH profile; use `web` only when it is the user's target.
- Never print OAuth credentials, refresh tokens, authorization callbacks, or
  the credential store.
- Do not start, stop, or restart DSH without explicit permission.
- Preserve the DSH profile, unrelated plugins, and stored OAuth credentials.
  Signing out requires explicit permission.
- Do not delete any DSH profile during install, update, verification, or uninstall.

## Install

When `dsh`, Node.js, and pnpm are available, install the package directly:

```sh
dsh plugin --profile web add dsh-cursor-subscription
```

For a local checkout (development), add it to the profile as a file dependency:

```sh
cd "%USERPROFILE%\.dsh\profiles\web"
pnpm add file:D:/mcp/dsh-cursor-subscription
```

Then ensure `dsh-cursor-subscription` is listed in the profile
`package.json` under `dsh.profile.bundles` (the `dsh plugin add` command does
this automatically for published packages).

pnpm (11+) applies a built-in 24-hour `minimumReleaseAge` supply-chain gate, so a
range such as `^0.5.0` never selects a version published within the last 24
hours. Right after a release, a plain `add` or `update` therefore falls back to
the newest release older than 24 hours — for a young package, the earliest
published version. Install the newest release by exempting this package by name
in the profile `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - dsh-cursor-subscription
```

Requesting one version explicitly (`dsh plugin --profile web add
dsh-cursor-subscription@0.5.8`) also works: pnpm then appends that single
version to the same list. Do not set `minimumReleaseAge: 0` just to install this
plugin; that drops the protection for every package in the profile.

Update with `dsh plugin --profile web update dsh-cursor-subscription`.
Uninstall with `dsh plugin --profile web remove dsh-cursor-subscription`.

## Verify

```sh
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

Success requires:

1. The requested package version appears once. A version older than the one
   requested means pnpm's 24-hour release-age gate resolved the range; see
   Install.
2. `cursor-subscription` appears once in the composed config after install
   or update, and is absent after uninstall.
3. No unrelated profile or plugin changed.
4. A running DSH process was not restarted by the operation.

Do not treat `dsh plugin --profile web peers check` as the completion test.
If the user authorizes a live check, restart DSH manually, open
**Settings -> Cursor**, and verify the page loads. The Cursor provider route
(`cursor-subscription`) must appear in the model picker. Only when the user
explicitly requests a live check, run one simple chat message and confirm the
streamed reply appears in the conversation.

The section title carries the version of the installed build next to it. That
number comes from the plugin's own manifest over the account channel, so it
matches `dsh plugin --profile web list dsh-cursor-subscription --depth 0`; a
missing chip on a loaded panel means the version request failed, not that the
plugin is unloaded.

The panel also contributes languages: besides the built-in Simplified Chinese and
English, **Settings -> General -> Language** lists Traditional Chinese, Japanese,
Korean, Spanish, French, German, Italian, Brazilian Portuguese, Russian, and
Arabic, and the panel mirrors itself for Arabic. Those entries come from the
panel's own `ctx.locale.addLanguage` calls, so they only appear on a DSH whose
locale runtime supports language packs; elsewhere the panel silently stays
zh/en. A missing language in that list is a locale-runtime question, not a
plugin-load failure.

## Failure handling

- If the settings page reports "无法读取 Cursor 状态" the loopback RPC failed;
  confirm the plugin bundle is listed once in the composed config.
- A boot failure reading `plugin tree failed to load: failed to apply loader
  entry cursor-subscription ... cannot get property "webServer" without inject`
  means a plugin build that mounted its account channel through
  `connection.rpc.handle` ran against a DSH whose Connection plugin no longer
  declares `webServer` (for example DSH 0.1.5-rc.1). Install version 0.5.8 or
  later, whose channel mount passes an owner context that declares `webServer`.
  Do not fix this by adding `webServer` to the plugin's own `inject`: the failing
  read happens on the providing plugin's scope and stays broken.
- A "Cursor subscription is not signed in" error on a model call means the
  credential store is empty; the user must complete the browser login flow.
- Cursor's Agent protocol is undocumented and changes; a transport or
  `CURSOR_ERROR` failure on the chat path is expected to need a plugin update.

On any failure, report the sanitized command error, DSH version, selected
profile, what changed, and what remains unverified. Do not patch DSH, wipe
credentials, delete a profile, or claim success from a partial check.

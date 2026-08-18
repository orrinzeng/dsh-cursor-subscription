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

Update with `dsh plugin --profile web update dsh-cursor-subscription`.
Uninstall with `dsh plugin --profile web remove dsh-cursor-subscription`.

## Verify

```sh
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

Success requires:

1. The requested package version appears once.
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

## Failure handling

- If the settings page reports "无法读取 Cursor 状态" the loopback RPC failed;
  confirm the plugin bundle is listed once in the composed config.
- A "Cursor subscription is not signed in" error on a model call means the
  credential store is empty; the user must complete the browser login flow.
- Cursor's Agent protocol is undocumented and changes; a transport or
  `CURSOR_ERROR` failure on the chat path is expected to need a plugin update.

On any failure, report the sanitized command error, DSH version, selected
profile, what changed, and what remains unverified. Do not patch DSH, wipe
credentials, delete a profile, or claim success from a partial check.

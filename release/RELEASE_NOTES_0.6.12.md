# dsh-cursor-subscription v0.6.12

DSH 0.2.0-rc.2 stopped booting this plugin, and the plugin was not at fault in the way a missing API usually is: nothing it called had been removed. The release added a **version-compatibility gate**, and this build declared the wrong line.

## What 0.2.0-rc.2 changed

Before a profile imports a plugin, DSH now compares every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` range in that plugin's `peerDependencies` against the running runtime version:

```js
semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

One unsatisfied range denies the whole plugin, and a denied plugin is denied *in the launcher's own copy of the composition* — it never imports its module, and it contributes no rows. That second half is what made the symptom confusing. The profile's own `cordis.patch.yml` carries a config override for the `cursor-subscription` entry, so a denied plugin does not report "incompatible" and stop: it reports

```
dsh: [C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml] patch: entry "cursor-subscription" not found
```

which reads like a broken profile, not like a refused plugin. The real message is on stderr above it:

```
dsh: warning: Plugin dsh-cursor-subscription@0.6.11 is incompatible with dsh 0.2.0-rc.2:
  peerDependencies {"@deepseek-ai/dsh-client-locale":"0.1.0-rc.6", ...}
```

Two details of the check are worth keeping. `@deepseek-ai/cordis` and `react` are not `@deepseek-ai/dsh-*` peers, so they are never inspected; and `includePrerelease: true` means a prerelease range matches a prerelease runtime more loosely than a bare `semver.satisfies` would — the old `>=0.1.0-rc.6 <0.2.0` bound on the Connection peer was in fact still satisfied by `0.2.0-rc.2`. Only the ten exact pins were not.

## What this build declares

Every DSH peer now names the line this build is tested against instead of a single prerelease:

| Peer | Was | Now |
|---|---|---|
| `@deepseek-ai/dsh-client-connection` | `>=0.1.0-rc.6 <0.2.0` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-client-locale`, `dsh-client-ui-primitives`, `dsh-client-ui-settings`, `dsh-client-ui-slots`, `dsh-client-ui-tool`, `dsh-credentials`, `dsh-settings`, `dsh-tools` | `0.1.0-rc.6` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-llm` | `^0.1.2-rc.1` | `^0.2.0-rc.2` |
| `@deepseek-ai/dsh-client-runtime` | `0.1.0-rc.6` | **removed** |
| `@deepseek-ai/cordis` | `4.0.1` | `~4.0.4` |

`^0.2.0-rc.2` deliberately covers the whole 0.2.x line rather than pinning `0.2.0-rc.2`. A pin would deny this plugin again on the next `0.2.0-rc.3`, which is the failure this release exists to stop repeating.

`@deepseek-ai/dsh-client-runtime` is gone from the 0.2.0-rc line — its last published version is `0.1.1-rc.2`, and no `0.2.0-rc.2` exists to satisfy. Leaving that peer behind would have denied the plugin on its own, whatever the other ten said, so it is removed from `peerDependencies` and from the client-side `dsh.client.inject` list. Its `slots` service now comes from the platform seed table: every first-party client bundle requires `@deepseek-ai/dsh-client-ui-primitives` exactly as this one does, and none of them declares it as a client external.

## One real API change: the Connection route options

`@deepseek-ai/dsh-client-connection` dropped a parameter between the lines. 0.1.x declared

```js
register(owner, channel, handler, options)   // options = { authority: "loopback" }
handle(channel, handler, options)
```

and 0.2.0-rc.2 declares

```js
register(owner, channel, handler)
handle(channel, handler)
```

The loopback pin is not a renamed option — it is gone. 0.2.0-rc.2 fences every registered channel through one service-level check (loopback or a configured trusted authority, then browser authentication), so there is no per-route authority left to state, and a fourth argument would be silently ignored rather than honoured. The plugin now reads the declared arity and passes the option only to a build that still advertises it, so the 0.1.x line keeps its narrower fence instead of appearing to have one.

On 0.2.0-rc.2 the account channel is therefore fenced by the deployment's own policy. On a default local install that is the same loopback-only fence as before, plus browser authentication; on a deployment that has configured `trustedHosts`, this channel now follows them like every other registered channel. That is a platform-imposed widening, not a choice this plugin made, and it is stated rather than hidden.

## Verification

- **Unit:** 104 host-side tests pass against the 0.2.0-rc.2 package line. The two this release adds cover the Connection signature both ways: a 0.1.x-shaped registry still receives `{ authority: "loopback" }`, and a 0.2.0-rc.2-shaped one — three declared parameters, no options — is registered correctly *and* is not handed the argument it would ignore, on both the `register` path and the `rpc.handle` fallback.
- **The gate itself:** `evaluatePluginCompatibility` from `@deepseek-ai/dsh-app-boot` 0.2.0-rc.2, called with this manifest and runtime `0.2.0-rc.2`, returns no incompatible peers. The same function on the 0.6.11 manifest reports the ten exact pins, matching the boot log.
- **Composition:** `dsh --profile web --dump-config` prints the `cursor-subscription` row with an empty stderr — no compatibility warning and no `patch: entry ... not found`. The row is attributed to the bundle layer and then to the profile patch, which is the layering that was failing.
- **Import and schema:** `dsh --profile web --dump-config-schema` imports every composed module and collects this plugin's Config schema (`replayHistoryEachStep` included), with no diagnostic for its row. The four `unrecognized Loader tree carrier` errors in that run belong to DSH's own `preset-standard`, `preset-ptc`, `preset-minimal` and `preset-cordis` rows.
- **Mount, in the running session:** with the plugin installed into a live `web` profile, `POST /cursor-subscription/version` answers **401 unauthorized** while an unknown path answers 405 — the route exists and is fenced by Connection's browser authentication, which is the 0.2.0-rc.2 `register` path running. The DSH process serving it had already been up for eleven minutes when the plugin was installed, and was not restarted.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.12
dsh plugin --profile web list dsh-cursor-subscription --depth 0
dsh --profile web --dump-config
```

Restart DSH manually afterwards and check that **Settings -> Cursor** shows `v0.6.12`.

## Compatibility and known notes

- This build declares the 0.2.0-rc line and no longer covers DSH 0.1.x. If you are still on a 0.1.x DSH, stay on 0.6.11: 0.6.12 will be refused by the 0.1.x composition the same way 0.6.11 is refused by 0.2.0-rc.2.
- To accept the risk for one exact pair without changing versions, grant an exemption — `dsh plugin --profile web allow-version dsh-cursor-subscription@<version> --dsh-version <dsh-version> --accept-risk`. An exemption is exact on both sides: neither a plugin upgrade nor a DSH upgrade inherits it.
- The runtime behaviour of the provider, the `Run` protocol, the tool bridge, the settings fields and the client panel are unchanged from v0.6.11. This release moves declarations and one registration call.
- The repository's `pnpm-workspace.yaml` now lists the 0.2.0-rc.2 packages in `minimumReleaseAgeExclude`, so a fresh `pnpm install` can resolve them while they are still inside pnpm's 24-hour release-age window.

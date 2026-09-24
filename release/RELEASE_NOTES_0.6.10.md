# dsh-cursor-subscription v0.6.10

Two things a Cursor turn kept to itself: the work it was doing while it ran, and
the way out of a refused tool call. A step showed one sentence and a tool card,
so a turn of them read as the same request being submitted again and again; and
a sandbox refusal arrived as a bare error, so the model concluded that local
tools do not work here instead of asking the user for permission.

## The work behind a step is visible now

Reasoning is the only channel an adapter has for showing work that is not answer
text. A Cursor step spends most of its wall clock on protocol round trips that
never reached the transcript: the native tool call the model tries first, the DSH
tool-schema fetch it makes next, and the thinking it finished before either. None
of that was visible, and the four deltas below now report it, prefixed `[cursor] `
on a reasoning block of their own (index 3) so the model's own thinking — block
index 1 — stays exactly what the model produced.

| when | what the transcript shows |
| --- | --- |
| the model finishes thinking | `[cursor] thinking finished after 4.2s` |
| a native Cursor tool is declined | `[cursor] native grep call declined; using the DSH tools instead` |
| the tool schemas were fetched | `[cursor] loaded the DSH tool schemas (27 tools)` |
| a DSH tool is about to run | `[cursor] calling the DSH tool grep` |

`thinking_completed` (`InteractionUpdate` field 5) carried the duration all
along and was ignored as an unknown update; it is decoded now. The other three
lines report events the adapter already handled and only ever answered on the
wire.

## A sandbox refusal carries the way to ask for approval

Every provider gets the same rule: when the sandbox refuses a call, retry that
exact call once with `sandbox_permissions` and a justification, and DSH raises an
approval prompt. Only the `pwsh` description spells it out — `write`, `edit` and
`read` carry 42, 59 and 56 characters of description with no such wording, and
the assembled system prompt says nothing about the sandbox at all. The refusal
result itself carried no remedy either; the one a Cursor turn received was:

```text
Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\myworks\mkgame_front)
```

A model that does not recall the rule from a tool description reads that as "this
tool does not work here" and stops using it — which is how a turn ends up
reporting `本地工具不可用` and switching to search-only work. It is not that the
model cannot escalate: the same build was observed escalating eight times in one
session, first to `workspace-write` (refused by the ACL grant above) and then to
`danger-full-access`, which ran.

`withSandboxHint()` now appends the rule to a refusal, in both places a result
travels back to the model — the live-bridge `mcp_result` and the cold-start
history replay. The two refusal families read differently, because they call for
different answers. A policy refusal keeps the narrowest-first rule:

```text
[cursor] The DSH sandbox refused this call, and that is recoverable: retry this
exact call once with sandbox_permissions set to the narrowest wider mode that
suffices (workspace-write, or danger-full-access when that is not enough) plus a
one-sentence justification. DSH then asks the user to approve it. If the retry is
refused as well, stop and report it instead of trying another mode.
```

An ACL failure says plainly that no narrower mode can work, because naming one
first is what turned a single refusal into a retry loop — in one session a turn
asked for `workspace-write`, the mode it was already in, 101 times:

```text
[cursor] The DSH sandbox cannot start in this workspace — its own ACL grant fails
(`SetNamedSecurityInfoW`) — so no narrower mode can succeed. Retry this exact call
once with sandbox_permissions="danger-full-access" and a one-sentence
justification; DSH then asks the user to approve it. Do not retry it in a
narrower mode, and if the retry is refused, stop and report the refusal instead
of trying again.
```

The reader gets a line too: `[cursor] the sandbox refused a tool call; told the
model how to ask for approval`.

## A replay keeps what each request asked for

A cold start — a process restart, a lost bridge, or the rebuild that follows a
compaction — replays the DSH history as text, and a tool request used to replay
as `[Previous tool request: todo_write]` and nothing else. For a plan the request
*is* its argument, so the model came back without the list it had just written
and re-derived one; the same gap hides the search it already ran, which is how a
turn re-issues a call it has already made. Each replayed request now keeps its
arguments up to 600 characters: a plan survives whole, a whole-file `write` stays
bounded.

The churn this addresses, measured on one session: 15 `todo_write` calls, none
identical to the one before it, with a turn that rewrote the same three-item plan
in three consecutive steps while its first item stayed `in_progress` — and one
rewrite that came out in English. Plan churn is mostly a symptom of a turn that is
stuck: the plan tool replaces the entire list on every call and answers with a
count rather than the list, so any edit is a retype, and an agent that cannot make
progress edits the one thing it still controls.

## An opt-in rebuild that re-sends the history each step

`dsh-codex-subscription` and this plugin differ in one structural way, and it is
the reason a Codex model plowed through 114 steps of a session that stalled a
Cursor model: the Codex plugin speaks standard function calling, so its adapter
assembles the message history itself and every request carries it, while this
adapter delegates history to Cursor's server and sends deltas. The tool surface
follows from that: the Codex model only ever sees DSH's tools, while this one is
also offered Cursor's own, which have to be refused.

**Replay the full history each step** (Settings → Cursor, off by default) makes
every step rebuild the conversation from the DSH history instead of resuming the
conversation Cursor keeps, so the model sees the same explicit history a
function-calling adapter gives it. It is opt-in because Cursor has no
provider-side compaction: the whole transcript is re-sent each step, so tokens
grow with the step count.

The turn that motivated it carried `get_goal` four times, `todo_write` twice and
a re-stated goal in every step's text, while the `grep`, `glob` and `read` calls
in those same steps all returned real data — and **no native tool was attempted
at all** (0 mid-message round trips across 24 steps), which rules out the
refused-tool path as the cause.

## Verification

- **Unit:** 101 host-side tests pass. New cases: the four progress lines arrive in
  order, keep their `[cursor] ` prefix, leave the model's own thinking on its own
  block, and still hand the agent loop a real tool call; `thinking_completed`
  decodes to the duration Cursor reported; and with three results in flight — an
  ACL failure, a policy refusal and an ordinary result — each refusal is answered
  exactly once, the ACL failure names `danger-full-access` and forbids the
  narrower retry, the policy refusal keeps the narrowest-first rule, neither
  invites an unbounded loop, and the reader's line is emitted per refusal.
- **The replay case:** a cold-start action text keeps a `todo_write` request and
  the list it carried, keeps the result that answered it, and truncates a `write`
  whose body is 5,000 characters instead of replaying it.
- **The rebuild case:** with the switch on, a step whose tool result is in hand
  starts a fresh run, releases the bridge it does not resume, carries DSH's
  history and that result into the new run, and answers no abandoned exec; the
  settings RPC round-trip now covers the field and still drops an unknown key.
- **What Cursor actually receives, read back from a live session:** the `pwsh`
  description is 3,156 characters and states the escalation rule; `write`, `edit`
  and `read` are 42, 59 and 56 characters with no wording about it; the assembled
  system prompt is 7,816 characters with no mention of the sandbox or approvals.
- **What a refusal looks like today, read from the same session:** the result
  carried only the ACL error above, which is the text the hint now follows.
- **The loop this release ends, read from a `D:` session:** 101 ACL failures and
  49 escalations in one transcript, with a turn spending 80 tool calls on the
  same `workspace-write` retry until the user aborted it.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.10
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.10`.

## Compatibility and known notes

- Progress lines are transcript content: they replay in a cold start and appear
  in DSH's compaction summaries. The model's own thinking is untouched — the two
  kinds of reasoning sit on different block indexes.
- The escalation rule is appended only to a real sandbox refusal
  (`[sandbox: … denied]` or the `SetNamedSecurityInfoW` ACL failure) whose text
  does not already mention `sandbox_permissions`. An ordinary tool error is left
  exactly as it was.
- Cursor's native tools are still declined rather than executed; the transcript
  now says so, and says what to do instead.
- On a `D:` workspace the `workspace-write` sandbox cannot grant its own ACL
  (`SetNamedSecurityInfoW failed (Win32 5)`), which is why the hint names
  `danger-full-access` as the mode that suffices when a narrower one does not.
- The rebuild switch trades tokens for explicitness: with it on, a step's prompt
  grows with the whole transcript, and nothing on Cursor's side compacts it. It
  changes no other behaviour — the same tool calls, the same permissions, and
  the server-side conversation is simply not resumed.
- No new endpoints and no settings change: the run stream, the Config schema and
  the RPC surface are unchanged from v0.6.9.

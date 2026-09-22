# dsh-cursor-subscription v0.6.8

A Cursor turn that needed a tool could end right after the model said what it
was about to do — "I'll read that file" — with nothing actually happening. The
model had asked Cursor for one of its built-in tools, this build did not
recognize the request, and because nothing answered it the server waited for a
result that never came: the progress watchdog fired 60 seconds later and only
the preamble text survived into the conversation.

## Root cause

`ExecServerMessage` carries Cursor's tool requests. This build decodes the
variants it knows (read, ls, grep, write, delete, shell, fetch, diagnostics,
…), rejects each one with a message telling the model to use the DSH tools
instead, and forwards MCP calls (`mcp_args`) as real DSH tool calls.

Cursor adds exec variants without notice. This cycle it started sending an exec
whose args field is **36** — a message that carries only a workspace name, for
a tool this build has no name for. `decodeExecServerMessage` returned
`{ case: "unknown" }`, `rejectionFor()` returned `undefined` for it, and the
adapter therefore wrote no reply at all. Cursor's server, still holding an open
exec, sent nothing but heartbeats until the progress watchdog (`60s` with no
content) ended the step. The stall trace recorded the shape exactly:

```text
exec:requestContextArgs
interaction#27
exec:unknown
checkpoint(2719B)
heartbeat x6            <- 60s later: "Cursor stream progress timeout"
```

Because text had already been delivered, the watchdog stopped reading instead
of raising a retryable error (the v0.6.5 rule that keeps a delivered answer), so
the turn simply ended with the model's opening sentence and no tool ran.

## Fixed

### An exec this build cannot name is still answered

`ExecClientMessage` numbers its result variants exactly like
`ExecServerMessage` numbers its exec variants, so an unnameable exec can be
answered on its own field. `rejectionFor()` now returns, for an unknown exec:

- reply field = the exec's own field number;
- payload = the generic error shape `{ error = 2 { error = 1 } }` carrying the
  same reason the other native tools get ("Tool not available in this
  environment. Use the MCP tools provided instead.").

Field 19 (`span_context`) is a plain non-oneof field, so it is never mistaken
for the exec; a message that carries only ids and a span context has no exec to
answer and is left alone. The adapter logs one warning per run naming the field
it declined, and a second warning if an exec arrives with no addressable field
(the one case that can still stall).

### The trace names the field

`decodeExecServerMessage` keeps the field number of an unknown exec and the
message's top-level fields, and the stall trace prints
`exec:unknown#36[1,19,36,55]` instead of the bare `exec:unknown` that made this
hard to diagnose from the log alone.

## Verification

- **Live reproduction, before:** the two prompts below stalled and produced no
  tool call — the step ended with only the preamble text.

  | prompt | before | after |
  | --- | --- | --- |
  | read and summarise `package.json` | stall, no tool call | MCP `read` call at 9.5s |
  | read the first paragraph of `README.md` | stall, no tool call | MCP `read` call at 11.5s |

  Same result with `claude-opus-5-high`, the model in the failing session: the
  unknown exec is declined at 4.7s and the MCP `read` call arrives at 11.5s.
- **Reply shape probed against the live server:** with no reply the run stalls
  (7 frames, heartbeats only). Replying on the exec's own field resumes it —
  empty payload, `{ success = 1 }`, `{ error = 2 { error = 1 } }`, and
  `{ rejected = 3 }` all continue the run, and the server then reports
  `toolCallCompleted`. Replying on field 11 (`mcp_result`) instead stalls,
  which is why the reply must use the exec's own number.
- **Unit:** 91 host-side tests pass (proto 58, client-locales 8,
  client-usage-table 4, inject-contract 6, version 6, native-fetch 6,
  image-input 3). New cases: an unknown exec keeps field 36 and its top-level
  field list, the reply uses that field and decodes to the reject reason, a
  message with only ids and a span context is not answered on field 19, every
  outright-rejected exec answers on its own field number, and the adapter
  answers an unknown exec once, warns the operator, and keeps streaming until
  `turn_ended`.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.8
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.8`.

## Compatibility and known notes

- No new endpoints and no plugin API change: the same run stream is used, and
  `rejectionFor()` keeps its signature. `TOOL_REJECT_REASON` is now exported
  so tests and embedders can assert on the reason string.
- An unknown exec is declined, not implemented: the model is told to use the
  DSH tools, exactly like the native Cursor tools this build already knows.
  Such declines are not counted against the tool-round limit, matching the
  existing behaviour for native tools.
- A server exec with no addressable field still cannot be answered; that case
  now logs a warning naming it instead of failing silently.
- Cursor's Agent protocol stays undocumented and keeps growing; the trace now
  records the field numbers needed to extend the decoder.

# dsh-cursor-subscription v0.6.5

The frequent timeouts are fixed. They were not a network problem: the trace
added in 0.6.4 shows the connection healthy and the adapter waiting for a
checkpoint that Cursor does not always send.

## Root cause

A tool-call step ended like this (10 of 10 traces, 2026-09-18 16:38Z through
2026-09-19 14:46Z, `claude-opus-5-high`):

```
… tokenDelta × n | toolCallStarted | checkpoint(NB) | exec:mcpArgs | heartbeat ×6-7
```

Each report also carried `textChars=0 toolCallPending=true`,
`lastFrame=1-9s ago`, `lastContent=63-74s ago`.

- `lastFrame=1-9s` means the server was still sending heartbeats every ~5 s, so
  the HTTP/2 connection and the network were fine.
- The checkpoint arrives **before** the `mcpArgs` burst. The adapter assumed the
  opposite — its loop only left the tool-call step when a checkpoint followed
  `mcpArgs` — so it kept reading for a frame that was never coming. After 60 s
  the progress watchdog aborted the run with a retryable `TIMEOUT`, and DSH
  discarded the step and re-ran it, up to the retry limit.

This is why the timeouts looked random: they depend on the order in which the
server happens to emit the checkpoint and the tool call.

## Fixed

### A tool-call step no longer waits for a checkpoint that never comes

- The wait after `mcpArgs` is now capped by `TOOL_CALL_SETTLE_MS` (500 ms).
  Live probing shows sibling calls of one burst arrive ~100 ms apart and the
  closing checkpoint ~300 ms after the last call, so parallel calls still stay
  in the same step, and a shape that never sends the checkpoint settles instead
  of hanging.
- To stop early, `ConnectFrameReader` gained `pause()`/`resume()`: a paused
  reader keeps buffered frames, stops blocking, and accepts frames again when
  the next DSH step continues the same Run. Ending the reader (`finish()`) would
  have made the resumed step see instant EOF.
- A stall that happens after the step has already delivered something visible —
  answer text *or* a tool call — now stops reading instead of raising the
  retryable error, so DSH never discards work the user has already seen. A run
  that stalls before producing anything still fails with `TIMEOUT`.

The stall trace from 0.6.4 stays in place: it writes only when a stall happens,
and it is what turned this from a guess into a diagnosis.

## Verification

- **Live:** the parallel tool-call path still emits both calls in one step
  (`blocks=2`, `finish: tool-calls`, checkpoint at +287 ms, inside the settle
  window) with no added latency.
- **Unit:** 74 host-side tests pass (proto 45, client-locales 8, inject-contract
  6, version 6, native-fetch 6, image-input 3). The new case replays the traced
  shape — checkpoint, `mcpArgs`, then heartbeats only — and asserts the step
  returns `tool-calls` with the run left resumable, and that resuming it sends
  exactly one MCP result. Without the settle timer the same case takes the
  5 s watchdog path.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.5
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows
`v0.6.5`.

## Compatibility and known notes

- Stall reports keep landing in `~/.dsh/cursor-hang-trace.log`; delete the file
  freely, it is recreated on the next stall.
- Cursor's Agent protocol remains undocumented and changes over time.

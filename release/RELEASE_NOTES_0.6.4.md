# dsh-cursor-subscription v0.6.4

Follow-up to 0.6.3. That release ended a Cursor step on `turn_ended`; this one
also keeps an answer that Cursor has already streamed when the server then goes
silent *without* ending the turn, and records what the server sent so the real
cause can be pinned down.

**0.6.3 was not enough.** The same
`Cursor stream progress timeout: no content for 60000ms` retry was reproduced on
0.6.3 (`claude-opus-5-high`, DSH 0.1.6-alpha.2, 2026-09-18 18:33), which means
the server does not always send `turn_ended` before it stops producing content.

## Changed

### A delivered answer survives a silent server

- **Before:** a run that streamed its answer and then went quiet was aborted by
  the progress watchdog (`STREAM_PROGRESS_TIMEOUT_MS`, 60 s) with a retryable
  `TIMEOUT`. DSH then discarded the answer the user had already read and re-ran
  the step.
- **Now:** when a stall is detected and the run has already delivered visible
  text with no MCP tool call pending, the step ends cleanly (`stop`) and the
  answer stays. A run that stalls *without* having produced any text still fails
  with the retryable `TIMEOUT`, so a genuine hang is still reported as one.

### Stall diagnostics

Every stall appends a report to `~/.dsh/cursor-hang-trace.log` (and a warning
line through the plugin logger) containing the run's session, model, delivered
text length, tool-round count, checkpoint size, and the last 120 server frames
with timestamps — server heartbeats are collapsed. Frames the adapter does not
decode are reported by their protobuf field numbers, so a server message we
ignore is visible in the trace instead of being silently dropped.

This instrumentation is temporary: it is what the next fix will be based on, and
it will be removed once the server-side cause is understood.

## Tests

73 host-side tests pass (proto 44, client-locales 8, inject-contract 6,
version 6, native-fetch 6, image-input 3). New coverage: a run that streams text
and then only heartbeats finishes with `stop` and writes a trace that names the
text and heartbeat frames, while the existing heartbeat-only stall still fails
with `TIMEOUT`.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.4
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards. Two checks:

1. **Settings → Cursor** shows `v0.6.4` next to the title.
2. A Cursor answer that used to be cancelled after a while now stays; if the
   server still goes quiet, `~/.dsh/cursor-hang-trace.log` holds the frame trace
   for that run.

## Compatibility and known notes

- Cursor's Agent protocol remains undocumented and changes over time.

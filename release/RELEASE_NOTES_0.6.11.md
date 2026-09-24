# dsh-cursor-subscription v0.6.11

Two fixes for the same symptom, and a switch for the structural cause of it. A Cursor turn was observed re-deriving its own plan instead of working: the step restated its goal, read its goal back, rewrote its plan, and never moved past the first item — while every tool call it made returned real data.

## A replay keeps what each request asked for

A cold start — a process restart, a lost bridge, or the rebuild that follows a compaction — replays the DSH history as text, and a tool request used to replay as `[Previous tool request: todo_write]` and nothing else. For a plan the request *is* its argument, so the model came back without the list it had just written and re-derived one; the same gap hides the search it already ran, which is how a turn re-issues a call it has already made. Each replayed request now keeps its arguments up to 600 characters: a plan survives whole, a whole-file `write` stays bounded.

The churn this addresses, measured on one session: 15 `todo_write` calls, none identical to the one before it, with a turn that rewrote the same three-item plan in three consecutive steps while its first item stayed `in_progress` — and one rewrite that came out in English. Plan churn is mostly a symptom of a turn that is stuck: the plan tool replaces the entire list on every call and answers with a count rather than the list, so any edit is a retype, and an agent that cannot make progress edits the one thing it still controls.

## An opt-in rebuild that re-sends the history each step

`dsh-codex-subscription` and this plugin differ in one structural way, and it is the reason a Codex model plowed through 114 steps of a session that stalled a Cursor model: the Codex plugin speaks standard function calling, so its adapter assembles the message history itself and every request carries it, while this adapter delegates history to Cursor's server and sends deltas. The tool surface follows from that: the Codex model only ever sees DSH's tools, while this one is also offered Cursor's own, which have to be refused.

**Replay the full history each step** (Settings → Cursor, off by default) makes every step rebuild the conversation from the DSH history instead of resuming the conversation Cursor keeps, so the model sees the same explicit history a function-calling adapter gives it. It is opt-in because Cursor has no provider-side compaction: the whole transcript is re-sent each step, so tokens grow with the step count.

The turn that motivated it carried `get_goal` four times, `todo_write` twice and a re-stated goal in every step's text, while the `grep`, `glob` and `read` calls in those same steps all returned real data — and **no native tool was attempted at all** (0 mid-message round trips across 24 steps), which rules out the refused-tool path as the cause.

## Verification

- **Unit:** 101 host-side tests pass. The two cases this release adds: a cold-start action text keeps a `todo_write` request and the list it carried, keeps the result that answered it, and truncates a `write` whose body is 5,000 characters instead of replaying it; and with the switch on, a step whose tool result is in hand starts a fresh run, releases the bridge it does not resume, carries DSH's history and that result into the new run, and answers no abandoned exec, while the settings RPC round-trip covers the new field and still drops an unknown key.
- **Unchanged paths:** the resume path, the sandbox-refusal hints, the protocol progress lines and the tool-result handling from v0.6.10 all keep their tests green.
- **The churn, read from a real session:** 15 `todo_write` calls with no two consecutive lists identical, three consecutive rewrites of one three-item plan, and one rewrite in English.
- **The stall, read from a real session:** in a turn the user aborted, `get_goal` four times plus `todo_write` twice, with `grep`, `glob` and `read` all returning data in the same steps and no native tool request attempted.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-cursor-subscription@0.6.11
dsh plugin --profile web list dsh-cursor-subscription --depth 0
```

Restart DSH manually afterwards and check that **Settings → Cursor** shows `v0.6.11` and that the runtime-settings card lists **Replay the full history each step**.

## Compatibility and known notes

- The rebuild switch trades tokens for explicitness: with it on, a step's prompt grows with the whole transcript, and nothing on Cursor's side compacts it. It changes no other behaviour — the same tool calls, the same permissions, and the server-side conversation is simply not resumed.
- Replayed requests keep at most 600 characters of arguments. A plan fits whole; a file body does not, and its result is in the transcript anyway.
- The switch is the only new setting. The run stream, the Config schema besides that field, and the RPC surface are unchanged from v0.6.10.
- Turning the switch on is an experiment, not a default: it is the one place where this adapter can be brought closer to how a function-calling plugin behaves, and it costs tokens per step. If a turn still re-derives its plan with it on, the cause is not the delegated history.

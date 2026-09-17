# Issue 331 Claude CLI result captures

## Provenance

The coordinating session captured the three source streams on 2026-09-15 with Claude Code 2.1.272 in a temporary directory. It reported exit code 0 for all three invocations and reported that no repository control was skipped. These statements are coordinator-supplied provenance; the fixture payloads are captured CLI output.

The complete supplied initial command was:

```sh
claude -p --model sonnet --session-id 11111111-1111-4111-8111-111111111111 --output-format stream-json --verbose --tools "" --max-budget-usd 0.50
```

Its supplied prompt was `Reply CT_CAPTURE_331 only`.

Only `--resume 11111111-1111-4111-8111-111111111111` and the prompt `CT_CAPTURE_RESUMED_331` were supplied for the resumed invocation. The complete command was not supplied.

Only `--model sonnet --tools Read --max-turns 1 --max-budget-usd 0.50` was supplied for the turn-limit invocation. The coordinator described its prompt as asking Claude to read `input.txt` and report its token; the verbatim prompt and complete command were not supplied.

## Fixture reduction

The fixtures retain only each source stream's complete `result` line:

- `claude-result-initial.jsonl` comes from `initial.jsonl` line 10.
- `claude-result-resumed.jsonl` comes from `resumed.jsonl` line 9.
- `claude-result-turn-limit.jsonl` comes from `turn-limit.jsonl` line 12.

Initialization, hook, rate-limit, assistant, tool-use, tool-result, request, path, and timestamp metadata outside those result lines is omitted. The initial and resumed session identity is replaced consistently with `11111111-1111-4111-8111-111111111111`; the turn-limit session identity is replaced with `22222222-2222-4222-8222-222222222222`. Result UUIDs are replaced deterministically with valid UUID pseudonyms. The same session substitutions are applied to the supplied command fragments above. All other result fields and numeric literals are retained verbatim.

## Observations

The initial result is `success` with `is_error: false`, reported total USD `0.4208795`, one turn, and CLI duration 7071 ms.

The resumed result is `error_max_budget_usd` with reported total USD `1.051838`, one turn, and CLI duration 4876 ms. Its terminal result reports zero usage and `duration_api_ms: 0`, while the omitted preceding assistant event reports nonzero usage. This evidence therefore does not establish that no model work occurred. The reported total exceeded the supplied `0.50` option; it is retained as reported and is not treated as incremental spend, an invoice, or proof of an enforced spending ceiling.

The turn-limit result is `error_max_turns` with reported total USD `0.42424649999999997`, two turns, and CLI duration 4784 ms.

There is no capture of a successful resumed invocation. These captures establish no attributable resumed-call cost and no resume-success guarantee. Tests that alter captured envelopes are labelled synthetic and do not represent additional CLI observations. No further Claude invocation was made.

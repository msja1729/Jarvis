# Token baseline (criterion 9)

Measured once against the real CLI with `npm run measure` (`scripts/measure-baseline.ts`).

- Date: 2026-11-07
- Claude Code: 2.1.318, Windows 11, Claude Pro login
- Model: `haiku` (claude-haiku-5-5) for both runs, so only the fixed cost differs
- Request: `say hello`
- Tokens = input + cache creation + cache read + output, from the JSON `usage` field

| Setup | input | cache creation | cache read | output | **total** |
|---|---:|---:|---:|---:|---:|
| Claude Code defaults (`claude -p "say hello" --output-format json --model haiku`, empty folder) | 2 | 13,823 | 27,275 | 36 | **41,136** |
| Jarvis settings (flags from `brain/args.ts`, Gateway with Gmail + Google Calendar on: 8 tools) | 2 | 2,692 | 0 | 48 | **2,742** |

Reduction: **93.3%** (requirement: at least 50%)

For reference, Jarvis with no apps turned on (no Gateway tools) cost 1,048 tokens for a similar request.

## End-to-end check run in the same session

- `list my 3 latest emails` (haiku): Claude called `mcp__jarvis__gmail__list_emails` once through the shim → control server → GatewayCore (fake inbox), the UI progress label "Reading Gmail…" was emitted, and the reply listed all three mails. 5,879 tokens.
- Follow-up `who sent the second one?` with `--resume`: answered "HR" from the earlier turn, same session id (criterion 5 on the real CLI).

Note: this script starts `claude` directly (outside `brain/`) only to run the Claude Code **defaults** for comparison. The app itself never does.

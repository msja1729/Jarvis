# PLAN.md — Jarvis implementation plan

Companion to `SPEC.md`. This file records the decisions taken on the spec's open
questions, the exact Claude Code CLI flags (verified against `claude --help`,
Claude Code 2.1.318), the module layout, and the build order.

## 1. Resolved open questions

| # | Question | Decision |
|---|---|---|
| 1 | Wider release | **Not resolved, still blocking any release beyond the peer group.** v1 stays private. Before a wider release: ask Anthropic for approval or ship an API-key `Brain`. |
| 2 | Desktop framework | **Electron** (TypeScript everywhere). One codebase, `electron-builder` makes one installer per platform (`.dmg` universal, NSIS `.exe`). |
| 3 | Local speech | **whisper.cpp** (`base.en` model, downloaded on first use) for speech-to-text; **OS voices** through the Web Speech API (`speechSynthesis`) for text-to-speech. |
| 4 | Meeting recording | **Record only** (system audio + mic). No meeting bots. |
| 5 | Memory across conversations | **Off** by default. |

## 2. How Jarvis drives the CLI (SPEC 4.4)

Every brain run is exactly:

```
claude -p <request>
  --output-format stream-json --verbose
  --model <haiku|sonnet>
  --max-turns 8
  --tools ""                       # T3: all built-in tools off
  --system-prompt <JARVIS_PROMPT>  # T2: replaces the coding prompt
  --mcp-config <json string>       # only server: "jarvis" (the Gateway shim)
  --strict-mcp-config              # ignore every other MCP config
  --allowedTools mcp__jarvis       # Gateway tools pre-approved
  --permission-mode dontAsk        # anything not pre-approved is denied
  --permission-prompts none
  --setting-sources ""             # ignore user/project hooks and settings
  --disable-slash-commands
  [--resume <session_id>]
```

* `--max-turns` is hidden from `--help` but accepted (verified: an unknown flag errors, this one does not).
* The process environment is copied with `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`) removed. The user is told when that happened.
* `MCP_TOOL_TIMEOUT` is set to 5 minutes so an "Ask me first" popup can wait for a click.
* The working directory is a Jarvis-owned empty folder (`<userData>/brain-cwd`) so no project `CLAUDE.md` is picked up.
* The bypass-permissions flag is never built. A test scans the source tree for it.
* Login check: `claude auth status` (JSON, `loggedIn`, `authMethod`). Jarvis reads only those two fields and never stores the output.

### stream-json events used

| Event | Use |
|---|---|
| `{"type":"system","subtype":"init","session_id",...}` | session id, model |
| `{"type":"assistant","message":{"content":[{type:"tool_use",name}...]}}` | live progress: "Reading Gmail…" |
| `{"type":"rate_limit_event","rate_limit_info":{"status"}}` | `status:"rejected"` → usage-limit message |
| `{"type":"result","is_error","result","session_id","usage":{...}}` | reply, session, tokens |

`tokens_used = input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens`.

First measured data point (haiku, Jarvis prompt, no tools, "say hello in 3 words"): 2 input + 1,036 cache-creation + 10 output tokens.

## 3. Gateway design

```
claude ──stdio MCP──> gateway/shim (tiny Node process, started by claude)
                          │  HTTP 127.0.0.1:<random port>, bearer token
                          ▼
                     Jarvis main process: gateway/control-server → GatewayCore
                          ├─ ability check (Off / Ask / Allowed)  ← settings.json
                          ├─ confirmation popup (renderer) for Ask
                          ├─ executors: built-in tools + MCP proxy for user apps
                          ├─ trim(result)  (T5)
                          └─ activity log
```

* The shim holds no logic and no secrets. It forwards `tools/list` and `tools/call`.
* All policy lives in `GatewayCore`, which is in the app process and is plain TypeScript (unit-tested without Electron).
* A new `claude` run starts a new shim, which asks for the tool list again, so setting changes apply on the next request (criterion 26).
* Tool names are `<appId>__<ability>`, which Claude sees as `mcp__jarvis__<appId>__<ability>`.
* Tool list order: apps sorted by id, abilities in declared order. Descriptions are fixed strings → byte-identical (T10, criterion 17).
* Effective setting: app disabled → Off. Missing group → `act`. Destructive saved as Allowed → rejected on save, and coerced to Ask at call time.
* The shim is launched with Electron's own binary (`ELECTRON_RUN_AS_NODE=1`), so users need no separate Node.js.

## 4. Storage

| Data | Where |
|---|---|
| App credentials (OAuth tokens, API keys) | OS store through `@napi-rs/keyring` (Keychain / Credential Manager) |
| Ability settings, enabled apps, preferences | `<userData>/settings.json` (no secrets) |
| Activity log | `<userData>/activity.jsonl` |
| Usage log + baseline | `<userData>/usage.jsonl`, `<userData>/baseline.json` |
| Transcripts | `<userData>/transcripts/` |

## 5. Module layout

```
app/        Electron main, preload, renderer UI, Orchestrator (router → brain), setup wizard
router/     local commands (T1), model pick (T9)
brain/      Brain interface, ClaudeCLIBrain, args, env, stream parser, sessions (T6), usage log, setup checks, system prompt
gateway/    types, app registry + settings, GatewayCore, trim, activity log, control server, stdio shim, MCP proxy
tools/      email/, calendar/, recorder/, screen/, whiteboard/
speech/     whisper.cpp STT wrapper, TTS helper
security/   SecretStore (keyring), destructive lock
tests/      vitest tests per criterion, stub claude, recorded fixtures, token_baseline.md
scripts/    build (esbuild)
```

## 6. Build order

| Phase | Content | Status |
|---|---|---|
| 1 | PLAN, scaffold, router, brain (+stub claude), gateway core/shim/control server, security, usage + activity logs, Gmail/Calendar trimming, basic Electron chat UI with confirmation popup, Tool Hub, usage panel, activity log | **done** (2026-11-07; 60 tests pass, real-CLI end-to-end check in `tests/token_baseline.md`) |
| 2 | Gmail + Google Calendar OAuth (loopback redirect), Outlook via Microsoft Graph, add-app-by-URL (remote MCP) | **done** (2026-11-07; see section 8) |
| 3 | Screen look (desktopCapturer, area picker, 1280 px scaling), whiteboard canvas + tools + PNG/PDF export | **done** (glass board, eraser for user and Claude) |
| 4 | Recorder (system audio + mic), whisper.cpp transcription, chunked summary, global push-to-talk, floating box polish, TTS | **done** (see section 9) |
| 5 | Installers (electron-builder), criterion 9 measurement vs. defaults, README polish | |

## 7. Testing

* `vitest`. Each acceptance criterion has a test named `cNN-*.test.ts` (UI/hardware criteria get logic-level tests plus a manual checklist).
* Stub `claude` (`tests/stub/claude.mjs`) replays recorded stream-json fixtures and writes its argv + env to a capture file, so tests assert flags and environment with no Pro usage.
* Criterion 9 is measured once against the real CLI; numbers go in `tests/token_baseline.md`.

## 8. Phase 2 notes (sign-in)

* **OAuth for Google and Microsoft**: authorization code + PKCE (S256), loopback redirect (`http://127.0.0.1:<port>` for Google, `http://localhost:<port>` for Microsoft, listening on both IPv4 and IPv6 loopback), random `state` checked on return, 5-minute timeout, cancel button.
* **Each user brings their own OAuth client** (Google "Desktop app" client ID + secret; Microsoft public-client ID). Client IDs are public and live in `settings.json`; the Google desktop client secret goes to the keychain anyway. Guides: `docs/connect-google.md`, `docs/connect-microsoft.md`.
* **Scopes**: Google `gmail.modify` (read, drafts, send drafts, trash; no permanent delete) + `calendar.events`. Microsoft `offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite`.
* **Tokens**: refresh token in the keychain, access token only in memory. Refreshes are shared between concurrent calls; rotated refresh tokens are saved; `invalid_grant` disconnects the account and tells the user to sign in again.
* **Windows keychain limit**: one Credential Manager entry holds at most 1,280 UTF-16 chars (verified). `ChunkedSecretStore` splits longer values across `key#1..n` entries.
* **Google "Testing" mode** expires refresh tokens after 7 days; the guide tells users to publish the (unverified) app to avoid this.
* **Remote MCP apps**: `JarvisMcpAuth` implements the SDK's `OAuthClientProvider` (dynamic client registration, PKCE, keychain storage). The browser only opens from the Tool Hub; during a chat an expired sign-in returns "<App> needs you to sign in again" instead.
* **Suggested apps** (endpoints verified live, all with dynamic registration): Notion, Linear, Jira & Confluence, Asana; GitHub uses a personal access token (no dynamic registration).
* **Not connected = not listed**: built-in apps whose account is not signed in are left out of the tool list even when switched on.
* Not yet verified against the real Google/Microsoft/Notion sign-in pages (needs the user's accounts); covered by tests against a local fake identity provider and a fake OAuth-protected MCP server.

## 9. Phase 4 notes (voice)

* **Speech-to-text:** whisper.cpp `whisper-cli`, model `ggml-base.en`. Windows build pinned to release b5130 `whisper-bin-x64.zip` (SHA-256 f9ec6c52…316f3c); model SHA-256 a03779c8…6c6d002. Both verified after download; nothing is installed on a mismatch. macOS has no official build: Homebrew `whisper-cpp`.
* **Measured:** a 5-second sentence transcribes in about 1.5 s on this machine (model load included), word-perfect.
* **Capture:** renderer `AudioContext` at 16 kHz + `AudioWorklet` → Int16 PCM over IPC. Meetings add the computer's sound via `getDisplayMedia` answered by `setDisplayMediaRequestHandler` with `audio: 'loopback'` (Windows). Main window has `backgroundThrottling: false` so capture works while hidden. Permissions: audio only, own pages only.
* **Push-to-talk:** Electron global shortcuts report presses, not releases, so the hotkey toggles; Jarvis stops after 1.2 s of silence, 8 s with no speech, or 30 s. Default `Control+Alt+Space` (`Alt+Space` on macOS); Ctrl+Shift+J was avoided because it is Chrome's console shortcut. Configurable in Settings.
* **Recorder:** 30-second WAV segments transcribed while recording; transcript written on stop; audio deleted once transcribed (kept only for parts that failed). "stop recording" is local (0 tokens) and returns a follow-up request for the summary, which Claude reads through `recorder__read_transcript` in parts of at most 3,500 chars.
* **Badges:** REC (with timer, consent reminder, Stop) and Listening (level meter) are always-on-top windows excluded from screen captures.
* **Criterion 7:** only `brain/` starts `claude`; `speech/whisper.ts` is the only other process starter and only runs whisper-cli (tested).
* **Verified without the user's microphone:** capture path run in a hidden window with Chromium's fake microphone (1.8 s of 16 kHz PCM in 2 s, speech level detected) and Windows loopback (computer sound captured).

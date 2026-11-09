# Jarvis

A desktop assistant for macOS and Windows. You talk to it by text (voice is coming) and it works in the apps you connect, but only in the ways you allow. It runs on **your own Claude Pro plan** through the Claude Code CLI, and it is built to use as few tokens as possible.

> Private v1 for a small group of peers. Each person uses their own Claude login. See `SPEC.md` (open question 1) before sharing it more widely.

## What works today (phases 1–4)

- Chat window and a floating box (**Ctrl/Cmd+Shift+Space** from any app)
- Setup wizard: finds `claude`, checks the login, runs one test request and records your baseline
- **Google account**: Gmail (read, draft, send after Yes, trash after Yes) and Google Calendar. One-time setup: [docs/connect-google.md](docs/connect-google.md)
- **Microsoft account**: Outlook mail and Outlook calendar, same abilities. One-time setup: [docs/connect-microsoft.md](docs/connect-microsoft.md)
- **Add more apps** in one click: Notion, Linear, Jira & Confluence, Asana (sign in through your browser), and GitHub (access token). Any other MCP app by address or command.
- Jarvis Gateway: every tool call goes through the Off / Ask me first / Allowed check, the confirmation popup, result trimming, and the activity log. Apps that are switched on but not signed in are hidden from Claude.
- Usage panel: tokens per request, today's total, the most expensive requests, and anything above 3× your baseline
- Commands handled locally (0 tokens): "new conversation", "open Tool Hub", "show usage", "open/clear whiteboard", "mute/unmute voice"
- **Lessons** (on by default): ask Jarvis to explain or teach anything and it plays a narrated, step-by-step lesson in its own window: flowcharts and diagrams (Mermaid), charts, animated function graphs, moving scenes, equations (KaTeX), notes and tables, each appearing as the voice explains it. It opens on an empty side of your screen so you can keep watching what you were looking at, or full screen when there is no room. Space pauses, arrows step, F switches side/full screen, Esc closes; push-to-talk pauses it so you can ask a follow-up.
- **Your team of experts**: Jarvis is the front desk for a team with names you can change on the Team page: **Maya** the PA, **Alan** the Educator, **Ryan** the Project Manager, **Sara** the Doctor and **Victor** for Finance. Talk to them like people ("Sara, what should I eat?"). The team: **PA** (schedule, meetings, email, daily plan), **Educator** (lessons, visual maths), **Project Manager** (coding with Claude Code, progress, deadlines), **Doctor** (food, sleep, exercise, explaining reports; not a replacement for a real doctor) and **Finance** (budgets, investing basics, business analysis; not regulated advice). Talk to one by name ("Doctor, what should I eat?"), pick one with the chips above the chat, or just ask and Jarvis routes it on your computer for free. Each member has its own expertise, only its own apps (smaller, cheaper requests), its own conversation, a natural voice you choose on the **Team** page, and a memory kept in your Jarvis folder that is summarised as you talk (read, edit or delete it on the Team page). Members ask each other for help when needed (one hop, so they never loop).
- **Reminders, morning plan and project board**: Maya reminds you at the right time, out loud on the voice card ("Maya, remind me to call Mom at 6 pm"); turn on her morning plan on the Team page and she plans your day at that time and sets a reminder before each meeting. A project board (to do / doing / done) on the Team page is shared by Maya and Ryan; coding jobs appear on it automatically.
- **Fast spoken replies**: when you talk, Jarvis starts speaking the first sentence while Claude is still writing the rest (about 3 seconds to the first word instead of 6 to 7), and spoken questions get short spoken answers. The natural voice trims the model's built-in silence and pauses naturally at commas and full stops.
- **One chat history**: conversations from the chat, the voice card and the floating box are kept together on this computer and shown again when Jarvis opens (Settings: switch off or clear).
- **Web search** (Tool Hub → suggested, no account needed): Exa web search and page reading for current facts; results are treated as data, never instructions.
- **Coding supervisor** (included, off until you turn it on in the Tool Hub): say "Jarvis, add a login page to my project", pick the folder, and carry on with other work. Jarvis runs Claude Code on it in the background and acts like a personal assistant: Claude's questions come to you as a small card (and spoken) with Jarvis's recommendation and reason; safe steps (reading, editing project files, tests and builds) are approved for you; risky ones (deleting, git push, installing, network, anything outside the folder, key/password files) always wait for your answer. You get progress updates and a summary at the end, can answer by voice ("go with yours", "the second one", "no, keep it"), give more instructions, stop it, or open the project in VS Code. Permission checks are never skipped. Settings → Coding supervisor sets how much Jarvis may approve and how often it updates you, and can also tell you when Claude Code sessions you start yourself (VS Code, terminal) finish or need you (this adds two marked hooks to your Claude Code settings, removed again when you turn it off).
- **Visual maths**: for maths, lessons teach picture-first on an animated coordinate plane: curves draw themselves, a tangent slides along a curve as a value changes, the whole grid bends under a matrix, rectangles fill the area under a curve, and equations transform step by step with each quantity in its own colour. Every graph is interactive: drag the points, move the sliders, click then scroll to zoom, drag to pan, and press Replay.
- **Explains at your level**: Settings → "How Jarvis explains things" picks Automatic, Like I'm five, Student or Professional (or just say "explain like I'm five"). Simple questions get a plain answer; bigger topics get a lesson, and problems get Problem → Intuition → Solution → Recap.
- **References**: when Jarvis explains your screen, a PDF or code, the lesson quotes the exact words or code it is talking about with where they are (page, `file:line`), shows a highlighted cut-out of your screen, and ends with a numbered References list.
- **Documents & code** (on by default, read-only): Jarvis reads a PDF, text file or code folder that you pick in a file picker, searches it, and cites pages and lines. It cannot read anything you did not pick, never leaves the chosen folder, and never reads key, password or `.env` files.
- **Natural voice**: replies are spoken by a realistic neural voice (Kokoro) running on your computer, starting after the first sentence; pick from 21 voices and a speed in Settings → Natural voice (one-time 326 MB download). Talking interrupts it.
- **Screen look**: pick the whole screen, one window, or an area; exactly one picture per request, shrunk to at most 1,280 px
- **Glass whiteboard**: Jarvis draws neon diagrams step by step and can erase; you draw with a dot-shaped pen, erase, undo, and save as PNG or PDF
- **Talk to Jarvis**: press **Ctrl+Alt+Space** (Mac: **Option+Space**) in any app, or click the mic button, and speak; it stops listening after a short pause. A small voice card above the taskbar shows what you said and the answer, reads the answer aloud, and fades away; no chat window opens. Speech is turned into text on your computer with whisper.cpp, never sent to Claude.
- **Meeting recorder**: "record this meeting" / "stop recording" (both 0 tokens). A REC badge with a Stop button stays on screen; Jarvis transcribes in 30-second parts while you talk, saves the transcript, deletes the audio, then summarizes the meeting.
- **Design**: soft frosted glass over a blurred colour field (from `UI design 2`), dark theme only

Planned next: installers (phase 5). See `PLAN.md`.

## Requirements

- macOS 13+ or Windows 10/11
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in with a Claude Pro (or higher) account
- Node.js 22+ (only to build from source)

### Install Claude Code

macOS:
```sh
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

Windows (PowerShell):
```powershell
irm https://claude.ai/install.ps1 | iex
claude auth login
```

If `ANTHROPIC_API_KEY` is set on your computer, Jarvis removes it for its own `claude` runs so usage counts against your plan, not API billing. It tells you when it does this.

## Run from source

```sh
npm install
npm approve-scripts esbuild electron-winstaller   # npm 11 blocks install scripts by default
npm start
```

On first launch, Jarvis walks you through setup and runs one small test request to record your baseline.

## Tests

```sh
npm test          # all acceptance-criterion tests; uses a stub `claude`, so no Pro usage
npm run typecheck
npm run measure   # criterion 9 only: real CLI, uses a few thousand tokens of your plan
```

Each test name starts with its acceptance criterion (C01–C33) from `SPEC.md`. C22–C25 (recorder, screen, whiteboard, push-to-talk) are marked todo until their phases.

## Build installers

```sh
npm run dist      # macOS: universal .dmg, Windows: NSIS .exe, written to release/
```

## Where things are stored

| What | Where |
|---|---|
| App passwords, sign-in tokens, API keys, Google client secret | macOS Keychain / Windows Credential Manager only (long values are split across several entries) |
| Ability settings, Google/Microsoft client IDs (public) | `<app data>/Jarvis/settings.json` (no secrets) |
| Activity log | `<app data>/Jarvis/activity.jsonl` |
| Usage log, baseline | `<app data>/Jarvis/usage.jsonl`, `baseline.json` |
| Meeting transcripts (text only; audio is deleted after transcription) | `<app data>/Jarvis/transcripts/` |
| Speech engine and model (one-time download, about 155 MB) | `<app data>/Jarvis/speech/` |

Jarvis never reads or stores your Claude login. Claude Code handles that itself.

## Layout

```
app/       Electron main, preload, renderer UI, orchestrator
router/    local commands and model choice
brain/     Brain interface and ClaudeCLIBrain (the only code that runs claude)
gateway/   ability checks, popups, trimming, activity log, MCP shim and proxy
tools/     Gmail, Outlook, Google Calendar, Outlook Calendar (screen, whiteboard, recorder to come)
speech/    whisper.cpp speech-to-text, push-to-talk, text-to-speech
security/  OS keychain store, OAuth sign-in (PKCE + loopback), accounts, destructive-action lock
docs/      step-by-step guides for connecting Google and Microsoft
tests/     tests per acceptance criterion, stub claude, token_baseline.md
```

## Voice setup

- **Windows:** open **Settings → Voice → Download speech engine** (or just use the mic; Jarvis offers the download). It fetches the official whisper.cpp build and the `base.en` model and checks both against their published SHA-256.
- **macOS:** whisper.cpp publishes no Mac build, so install it once with `brew install whisper-cpp`, then click **Check again**. The model is downloaded by Jarvis. Recording on a Mac captures the microphone only (computer sound is Windows-only for now).
- Tell other people in a meeting that you are recording. The rules differ between countries.

## Installing

`npm run dist` builds the Windows installer `release/Jarvis-Setup-<version>.exe` (about 170 MB). It is not code-signed yet, so Windows SmartScreen asks once: More info → Run anyway. Settings, voice models, memory and history live in your Jarvis folder (`%APPDATA%\Jarvis`) and are kept when you uninstall. The macOS build (one universal .dmg for Intel and Apple Silicon, macOS 13+) is configured but has to be built on a Mac; install the native packages for both chips first (`npm install --cpu=x64 --cpu=arm64`) so the voice engine and keychain work on both.

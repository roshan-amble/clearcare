# ClearCare: instructions for Claude

ClearCare is a private, local health record and AI insight system for one person (the user's mom): appointments,
medications, diagnoses and tests with their status history, her profile, weight and diet, uploaded documents, and an
AI chat on the home page that connects symptoms to the record and edits it. It is the sibling of ClearSpend and follows its rules. It is not production software and not a medical device.

## Read first

1. `README.md`: what it does, how to run it, privacy.
2. `docs/design.md`: the design records D1 to D13. If code and a record disagree, ask which one is right.

## Hard rules

- **Never commit health data.** `data/` (the record and `data/documents/` uploads) is git-ignored; keep it that way. Use the fictional sample (`sampleState`) in
  tests, examples and screenshots, never real records. Do not paste the contents of `data/health.json` into commits,
  issues, or anything published.
- An AI output changes nothing until a person accepts it. Accepting goes through `decideProposal`, which runs the same
  commands a person's edit runs. A new field the chat may set goes in `CHANGE_FIELDS`, never in a one-off code path.
- Keep the interface quiet: no record IDs, model or token details on screen; secondary actions live in edit windows.
- AI input is built on the server from stored records only. The browser sends IDs and the person's words.
- Code handles numbers, AI handles text. Due dates, flags, averages and timing links are computed in
  `packages/domain`; the model cites them and is told not to compute.
- Every AI output is validated by tested code in `packages/domain/src/ai/` before it is shown as valid. A failed check
  makes the run INVALID with reasons; an INVALID run is shown, never hidden or silently repaired. Length overflows are
  the one soft case: cut with a warning.
- The red-flag floor in `redflags.ts` is never lowered by AI. When unsure whether a phrase is negated, count it as present.
- The prompt never lets the model tell the user to start, stop or change a medication.
- `packages/domain` imports no React, SDK, Node file access or network. Lab values are exact decimal text.
- Keys stay in environment variables or the macOS Keychain (`clearcare-openai`). Never write a key into a file,
  the service plist included, and never ask the user to paste one into the chat.
- The service runs with `CLEARCARE_AI=codex` on purpose (the user's ChatGPT plan, no API credit): never a silent
  fallback to another engine. Codex must keep every tool disabled; it only answers.
- Sharing goes only through Tailscale Serve to the tailnet door (`CLEARCARE_TAILNET_PORT`), which stays bound to
  127.0.0.1 and requires a listed `Tailscale-User-Login`. Never enable Tailscale Funnel or bind a port beyond
  127.0.0.1. Only the local door may change the people list or the sample.
- Do not commit or push unless the user asks.

## Commands

- `npm test` runs the domain tests. `npm run typecheck` checks all packages. Node 22.13.0 comes from `mise.toml`.
- `npm run dev` starts the API (8091) and the app (8090). Use `CLEARCARE_DATA_DIR` to point at a scratch folder when
  testing, so the real record is untouched.
- `npm run ai:check` makes one real model call on the sample patient and writes nothing.

## Where things are

- Commands and status history: `packages/domain/src/commands.ts`
- Due dates and result flags: `results.ts`; computed facts: `facts.ts`; page view: `view.ts`
- Red flags: `redflags.ts`; the sample patient: `sample.ts`
- AI: `ai/record.ts` (what the model reads), `ai/chat.ts`, `ai/changes.ts` (record changes from the chat: field
  registry, schema, commands, in-order checks, "#N" links), `ai/extract.ts`, `ai/decide.ts`, `ai/runs.ts`
- Documents: `packages/domain/src/documents.ts` (C-CDA reading, which documents the model gets),
  `apps/server/src/documents.ts` (reading uploads, the text kept as `FILE-n.read.json`), `apps/server/native/doctext.swift`
  (PDF text and image text recognition, built with `swiftc` on first use)
- Server: `apps/server/src/main.ts` (routes, both doors), `viewer.ts` (who is asking), `store.ts`, `jobs.ts`,
  `ai/provider.ts` (engine choice), `ai/codex-cli.ts` (the engine in use), `ai/openai.ts`, `ai/anthropic.ts`, `ai/claude-cli.ts`, `ai/keys.ts`
- Mac service and sharing: `scripts/mac-service.sh`, `scripts/tailscale-share.sh`

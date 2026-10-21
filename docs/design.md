# ClearCare design records

Written on 2026-10-18 while building the first version. Each record states the decision, the options considered, and
why. The decisions marked **assumed** were made without asking, because the user was away; revisit them freely.

## D1: Scope

ClearCare stores four things and reasons over them: the schedule (appointments, visits to book, questions for
doctors, doctors), medications with their history, diagnoses and tests with a frequency and a status history, and a
chat with Claude. Two additions serve those four: check-ins (how she feels between visits; the chat needs them to
see a trend), and document extraction (typing a lab report by hand is the main reason a record goes stale).

Out of scope: more than one patient, accounts and login, reminders and notifications, a phone app, sharing with
doctors, insurance and billing.

## D2: Storage and backend (**assumed**)

- **A (chosen): a local server and one JSON file.** One process, no account, nothing to deploy. The file is readable
  and easy to back up, and one person's record stays small (hundreds of records). Writes are atomic and serialized;
  a copy is taken before the first change of each day.
- B: Palantir Foundry, like ClearSpend. Cost: Ontology changes need a branch and a proposal merged by a person, an
  OSDK per app, OAuth scopes, and a family member's health data in a developer enrollment.
- C: SQLite. Cost: a binary file nobody can read without tools, for no gain at this size.

The domain package stays free of storage code, so moving to B or C later means a new store, not new rules.

## D3: The AI boundary

1. **Inputs come from stored records only.** The server sends the whole record as one JSON packet (`ai/record.ts`,
   D12). The browser sends a thread ID and the person's words.
2. **The record is data.** The prompt says text inside the record is never an instruction.
3. **Outputs are validated** (`ai/chat.ts`, `ai/extract.ts`):
   - every cited ID was sent, and every quote is found word for word in the cited record's JSON (case, quote marks
     and spacing aside);
   - the urgency is not below the code red-flag floor (D4);
   - proposals point at records that exist and are open;
   - extracted items quote the document, and a result's value is inside its own quote;
   - a measurement in the answer that is in neither the record nor the message is a warning, not a refusal;
   - a list longer than the page shows is cut with a warning. Everything else that fails makes the run INVALID.
4. **Every run is stored**: job, record revision read, provider, model, status, reasons, warnings, output, tokens,
   duration, and each accept or dismiss decision.
5. **No effect until a person acts.** Accepting a proposal runs the ordinary commands, marked `source: AI` with the run ID.
6. **Code handles numbers.** Facts (`facts.ts`) carry every date gap, count and average. Claude cites them.

## D4: Safety

- A red-flag rule set in code (`redflags.ts`) sets a floor: EMERGENCY (call 911) or TODAY (call the doctor today). It
  runs as the person types, on every chat message, and on every check-in, and shows its advice before any model answers.
- Negation: a sign is negated only when a negation word is among the 3 words before it, or it continues a short
  negated "or" list ("no chest pain or sweating"). "Never" is not a negation ("never had chest pain like this before").
  Anything unclear counts as present: a false alarm is safer than a missed one.
- Combined rules carry the cases that matter for an older woman: arm, shoulder or jaw pain with sweating, nausea,
  breathlessness or dizziness is EMERGENCY; with unusual tiredness or weakness it is TODAY. A head injury is EMERGENCY
  when she takes a blood thinner (from her active medications).
- The prompt forbids medication changes and asks for follow-up questions without delaying urgent advice.
- The UI says on every chat that Claude can be wrong, is not her doctor, and that an emergency means 911.

## D5: Model and connection (**assumed**)

- Model: Claude Opus 5.5 (`claude-opus-5-5`), adaptive thinking (always on), effort `high` for chat (health reasoning
  is judgment-heavy) and `medium` for extraction. Structured output with a JSON schema; the schema uses only plain
  types, enums and `anyOf` with null, and code checks every bound.
- Connection: the Anthropic SDK when `ANTHROPIC_API_KEY` is set, with streaming, prompt caching on the instructions and
  the record, and server-side refusal fallbacks (`fallbacks: "default"`). Otherwise the local Claude CLI in headless
  mode, with no tools, plugins, hooks or MCP, no saved session, and the record on stdin. The CLI path exists because
  no API key was set on this machine and the user already uses Claude Code; it also made real end-to-end tests possible.

### Measured on 2026-10-18 (Claude CLI, sample patient)

| Run | Outcome | Time | Tokens in / out | List-price cost |
|---|---|---|---|---|
| Chat: "sluggish and weak, left arm hurting" (first prompt) | INVALID: 13 connections and 6 follow-ups over the limits | 52 s | 9,148 / 5,060 | $0.17 |
| Same question after stating the limits in the prompt | SUCCEEDED: urgency TODAY (floor TODAY), 8 connections, all quotes verified, 4 proposals | 42 s | 9,231 / 4,410 | $0.15 |
| Follow-up turn: "no chest pain or sweating; worse lifting overhead; heart rate 52" | SUCCEEDED: floor none, urgency TODAY, the focus moved from the arm to the slow heart rate | 39 s | 10,415 / 3,949 | $0.14 |
| Extract a cardiology after-visit summary | SUCCEEDED: 14 items, all quotes verified; matched the metoprolol change, hemoglobin and TSH to existing records | 17 s | 3,690 / 2,036 | $0.07 |

The first INVALID run led to two changes: the limits are now in the prompt, and an overlong list is cut with a warning
instead of refusing an otherwise sound answer.

## D6: Sharing with the patient through Tailscale

Chosen by the user on 2026-10-18 over a free cloud server (always on, but the Claude calls need a paid API key and
the app would need its own login) and a claude.ai-hosted page (a large rewrite, and the signed-in Claude account is a
work account).

- **Two doors.** The local door (port 8090 under the service) is this computer: the viewer is the first Family member
  on the list, or "You". The tailnet door (8092, bound to 127.0.0.1) is the only port Tailscale Serve forwards to.
  Every request there must carry `Tailscale-User-Login`, which Serve adds and strips from client input, and the login
  must be on the people list. Without a login, or with one not on the list, the request is refused and the login is
  kept in memory so the owner can add it.
- **Host checks.** Each door accepts only its own Host names; the tailnet door also accepts `*.ts.net`. A page that
  rebinds its own domain to 127.0.0.1 still sends its own name and is refused.
- **Only this computer** changes the people list, loads or clears the sample, or sees the record's path.
- **Who did it.** Chat messages, check-ins and questions record the person's name (and a message its role). The chat
  prompt marks each turn with `<asker>`; with the patient, Claude answers her as "you" and suggests telling family when
  something is urgent. Red-flag advice is worded for either reader.
- **The service.** A LaunchAgent (`scripts/mac-service.sh`) runs the built app at login and restarts it. It holds no
  key or token; Claude goes through the CLI's own sign-in, which was verified to work from launchd.
- **Verified on 2026-10-18** with a scratch record and a stand-in for Serve: refusal without a login (403), refusal of
  an unlisted login (403, shown to the owner), the patient let in, her edits to the list and the sample refused (403),
  her check-in marked as hers, a rebinding Host refused, a forged login ignored on the local door, and a real chat as
  the patient: urgency TODAY (code floor TODAY), addressed to her as "you", 44 s. Tailscale itself was not installed
  yet, so the real Serve path is untested.

## D7: The chat changes the record

Asked for by the user on 2026-10-19: anything the forms can do, the chat can do.

- **One field registry** (`ai/changes.ts`) lists every field Claude may set, per kind of record. It generates the
  output schema (every field required and nullable), turns a change into ordinary commands, and drives the change
  cards in the app. Kinds: SAVE (id null creates; an ID updates, keeping every field left null), STATUS, DELETE.
- **Checked in order on a copy.** The validator runs an answer's changes one after another on a copy of the record,
  with the same rules as a person's edit. A change that fails is kept and shown as refused, with the reason; the rest
  of the answer stays valid. This replaces refusing a whole answer for one bad suggestion.
- **Links inside one answer.** A change may point at an earlier change of the same answer with "#N". The check
  resolves it against the copy; applying resolves it against the IDs that earlier change actually created, and asks
  for that change first when it has not been applied.
- **Still one tap from a person.** Nothing is applied without Apply (or Apply all). Older answers' three proposal kinds
  are read as changes, so their cards keep working.
- **Measured on 2026-10-19** (Claude CLI, scratch records): "set up Mom's record" from one paragraph gave 8 changes,
  all passing, with medications linked to their conditions and the visit to its doctor (19 s); a mixed update gave 2
  changes and noticed that the dose change and the visit were already recorded (15 s); "he saw her this morning
  instead of Nov 3, stop the metformin" gave the visit marked done with his words, the medication stopped, the
  diabetes marked managed, and a follow-up question (19 s). When the person said a future visit had happened, Claude
  asked to confirm the date instead of changing anything.

## D8: Interface

Cut on 2026-10-19 at the user's request ("too much slop"): no record codes on screen, no token or cost lines, no
computed-facts list (Claude still reads it), no per-row button rows. A row opens its item; status changes, history,
cancel and delete live in the item's edit window. Home is the safety banner when there is one, an ask box, what is
coming up, what needs attention, and the feeling chart. Claude's reasoning links fold into "How this connects to her
record". Usage and cost moved into a folded section of Settings.

## D9: OpenAI as the engine

Asked for by the user on 2026-10-19: use their OpenAI API key for the chat instead of Claude Code sessions, with the
best available model.

- **Provider.** `apps/server/src/ai/openai.ts` calls the Responses API through the official `openai` SDK, with a
  strict JSON schema (`text.format`), `reasoning.effort` high for chat and medium for documents, 32,000 output tokens,
  and `store: false`. The schemas needed one change for OpenAI's strict mode: `const` becomes a one-value `enum`
  (tested). Every validator runs unchanged, because they check the output, not the engine.
- **Model.** `gpt-6.1-sol`, the newest model of OpenAI's top tier per its reasoning guide on 2026-10-19. `pro` mode
  is available behind `CLEARCARE_OPENAI_MODE` but off, since it costs more and is slower for a chat. `npm run
  ai:models` confirms the key can use it.
- **Key.** Read at start from `OPENAI_API_KEY` or the Keychain item `clearcare-openai`. It is never written to a file,
  the service's plist included, and never logged.
- **No silent fallback.** The service runs with `CLEARCARE_AI=openai`: without a key the chat says it is not
  connected, instead of falling back to the Claude CLI and spending the user's Claude usage. The setting is kept
  across `mac-service.sh restart`.
- **Wording.** The interface says "Ask" and "AI" instead of "Claude".
- **Not measured yet:** no OpenAI call has been made, because the key had not been added when this was written.

## D10: The ChatGPT plan instead of API credit

Asked for by the user on 2026-10-19: "I want my subscription to pay for this." The OpenAI key had no API credit, and
API usage is billed apart from a ChatGPT plan.

- **Engine.** `apps/server/src/ai/codex-cli.ts` runs `codex exec`, signed in with the user's ChatGPT account, so
  usage counts against the plan's limits. Flags: `--ephemeral`, `--ignore-user-config`, `--ignore-rules`,
  `--sandbox read-only` in an empty temporary folder, `--output-schema` (the same OpenAI-ready schema as D9),
  `--output-last-message`, `--json` for token use, `--model gpt-6.1-sol`, `model_reasoning_effort` high for chat and
  medium for documents, web search off, and every tool feature disabled (shell, unified exec, apps, browser, computer
  use, image generation, sub-agents, plugins, hooks, goals). The instructions, the record and the turns go in on stdin.
- **Selection.** The service runs with `CLEARCARE_AI=codex`; without a signed-in Codex the chat says how to sign in
  and uses nothing else.
- **Measured on 2026-10-19 (ChatGPT plan):** the sluggish-and-arm-pain question on the sample succeeded in 49 s
  (17,155 in, 2,324 out), every citation verified, urgency EMERGENCY above the TODAY floor; it refused one check-in
  that had a date and no time, which led to the prompt rule for times and a midday fallback. Reading the cardiology
  summary gave 14 items, all verified, in 21 s.
- **Shared limits.** Every question, the patient's included, counts against the user's plan.

## D11: Triage calibration

On 2026-10-19 the OpenAI model answered "call 911 now" to arm pain with a week of weakness, where the fixed rules
asked for a call to the doctor today. The user called that ridiculous. The prompt had told the model to "rate higher
whenever your judgment says so". It now triages like a phone nurse: EMERGENCY only when the message describes an
emergency sign happening now (chest pain or pressure, stroke signs, severe breathlessness, fainting, seizure, heavy
bleeding, face or throat swelling, self-harm), TODAY with the specific 911 signs to watch for otherwise, and a level
above the fixed-rule floor only for a reason it can name. The fixed rules still force EMERGENCY for those signs. The
same question then got TODAY, with the 911 signs listed, in 62 s on the ChatGPT plan.

## D12: Home is the chat, a calendar, diet, documents, a profile, and the whole record as JSON

Asked on 2026-10-19: Home and Ask were the same thing; the chat looked cluttered; the schedule should be an Apple
Calendar style month; check-ins were confusing; documents should take uploads; a diet tab to work on her weight; her profile should be a real bio; and every request should carry all her data as JSON.

- **One menu.** No sidebar: a three-bar menu button left of the ClearCare logo opens a panel with every page, on
  phones and computers alike. It is a modal dialog, so Escape and a tap outside close it.
- **Home is the chat.** One heading, "What's going on?", over a centered input. New chat and past chats are two
  icons in the corner. Red-flag advice still appears under the input as she types.
- **Schedule is a month calendar.** Today in a red circle, appointments as chips (dots on a phone), a day panel
  below. "Add appointment" is the only button. The check-in page is gone; the records stay (symptoms, vital signs
  and weight are logged through the chat or the Diet page) and show on their day. Questions for a visit live in its
  appointment window. Doctors moved to Settings.
- **Diet.** Weight is still a check-in field, so one log feeds the chart, the facts and the chat. Code works out
  the latest weight, the change over six months (the reading closest to six months back, within 21 days) or since
  the first reading, the change over 30 days, and what is left to the goal. The chart is one series with the goal
  as a labeled line. Meals are their own record type, and the chat can log them and set the goal.
- **Documents.** Any file up to 50 MB, sent as the raw request body and stored as `data/documents/FILE-n.ext`
  (git-ignored). Opened in the browser only for PDFs, images and text; anything else downloads, with `nosniff` and a
  sandbox policy, so an uploaded web page cannot run. Pasting into the chat replaces the document reader in the app.
- **Profile.** Birth date, sex, height, blood type, allergies, primary doctor, pharmacy, preferred hospital,
  mobility and aids, living situation, lifestyle, advance directive, healthcare proxy, emergency contact, insurance.
  Age and BMI are computed by code from the birth date, height and latest weight. The chat can update any of these.
  The primary doctor list ends with "Add a doctor…", which opens the doctor form and selects the new doctor.
- **The whole record as JSON.** Chosen over a JSON packet "with only the relevant parts" because the user asked for
  the whole file and a person's record is small: about 11,000 tokens for six months of sample data. Each record
  keeps its ID, and a computed section carries the facts (F1, ...), test flags and due dates, weight trends, age and
  BMI, so the model still does no arithmetic. Left out as bookkeeping: Tailscale logins, earlier AI answers, counters.
  This sends more than before: her emergency contact, proxy, insurance and doctors' phone numbers now go to the engine.
- **Speed.** The app is compressed (265 KB down to 85 KB) and its hashed files are cached for a year, so a phone
  downloads it once. Mom's phone reached the Mac through a Tailscale relay, which adds delay to every request.
  Chat effort on the ChatGPT plan moved from high to medium: on the same question with the JSON packet, high took
  57 s (24,168 tokens in, 2,749 out) and medium 36 s (24,166 in, 1,829 out); both passed every check, rated it
  TODAY, and cited the same metoprolol change, slow pulse and low hemoglobin. Set `CLEARCARE_CODEX_EFFORT=high` to go
  back.

## D13: The chat reads uploads; scans and biopsies are reports

Asked on 2026-10-20: the chat could not see uploaded documents (it saw names only and asked for pasted text), and
the test model fit only lab numbers. A pasted scan report was refused twice: a result needed an exact
date and one short value.

- **Reading.** Every upload is read once, on the Mac, when it arrives (older uploads at startup), and the text is kept
  next to the file as `FILE-n.read.json`. Health-record XML exports (C-CDA "Summary of Care") are parsed by domain
  code into sections, with the visit's date, type, doctor, specialty and clinic from the header. PDFs and pictures go
  through `apps/server/native/doctext.swift`, built on first use with `swiftc`: PDFKit for text, Vision text
  recognition for pictures and scanned pages. Word and RTF go through `textutil`. Nothing leaves the Mac to be read.
  The record keeps only a summary per file (`FileRead`), so the app stays small.
- **What the model gets.** A few years of portal exports can run to about 700,000 characters, too much to send with every question. Every
  document is listed (title, date, visit, reason, diagnoses, sections); text goes along, within 60,000 characters, for
  documents the person names (by a date, a month, or a word found in only a few documents' doctor, place or title),
  short documents, then the sections that best match their words. A section repeated across documents is sent once.
  The model can ask for up to 12 more documents by ID (`readDocuments`); the server sends their full text, within
  220,000 characters, and asks once more. Both runs are stored. Quotes from documents are checked like any record.
- **Measured** on fictional data (12 visit summaries, a PDF, a picture and a scan of the same MRI report): asked to
  build visit history, the model asked for all 12 visits (8 s), then proposed 7 doctors, 12 past visits and 9 results,
  all 28 passing the checks (75 s), and recognized the three copies of one MRI report. With about 50 visit summaries the
  first request is about 34,000 tokens; a second pass with 12 visits about 79,000.
- **Reports.** Test kinds add PATHOLOGY and PROCEDURE. Labs and vital signs keep a value, a range and a trend; every
  other kind is a report: a result has an impression, findings, the place, the doctor, the documents it came in, and
  an optional short value such as "BI-RADS 1". A date can be a month or a year ("March 2026"), stored as its first
  day with a precision. Flags and trends are never computed for reports. The Conditions page shows "Lab tests" as a
  table and "Scans & reports" as cards that open the full report; results can now be edited.
- **Visits from documents.** A past visit is a completed appointment with its summary in the visit notes and its
  documents linked (`fileIds`). The model is told never to write IDs into text a person reads.
- **Limits.** Suggestions per answer went from 12 to 30, so a long history arrives in a few rounds; the model says
  what is left. Reading is plain text: a table in a PDF arrives as lines, and handwriting may not be recognized.

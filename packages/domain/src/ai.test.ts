import { describe, expect, it } from "vitest";
import { CHANGE_FIELDS, changeToCommands, type ChangeProposal } from "./ai/changes.js";
import { buildChatRequest, validateChat, type ChatOutput } from "./ai/chat.js";
import { decideProposal } from "./ai/decide.js";
import { validateExtract, type ExtractOutput } from "./ai/extract.js";
import { renderRecord } from "./ai/record.js";
import { addImportDoc, addRun, appendMessage, startThread } from "./ai/runs.js";
import { quoteFound, unsupportedMeasurements } from "./ai/text.js";
import { applyCommand } from "./commands.js";
import { addDays } from "./dates.js";
import { dietSummary } from "./diet.js";
import { computeFacts } from "./facts.js";
import { sampleState } from "./sample.js";
import { applyAll } from "./commands.js";
import type { AiRun, HealthState } from "./types.js";
import { buildView } from "./view.js";

const NOW = "2026-10-18T09:00";
const TODAY = "2026-10-18";
const sample = sampleState(NOW);

function chatFor(state: HealthState, text: string) {
  const started = startThread(state, text, NOW);
  const withMessage = appendMessage(started.state, started.threadId, { role: "user", text, runId: null }, NOW);
  const thread = withMessage.threads.find((t) => t.id === started.threadId)!;
  return { state: withMessage, thread, request: buildChatRequest(withMessage, thread, TODAY, NOW) };
}

const blank = (collection: keyof typeof CHANGE_FIELDS) => Object.fromEntries(CHANGE_FIELDS[collection].map((spec) => [spec.key, null]));
const save = (collection: keyof typeof CHANGE_FIELDS, id: string | null, fields: Record<string, unknown>): ChangeProposal => ({
  kind: "SAVE",
  collection,
  id,
  summary: `Save ${collection}`,
  fields: { ...blank(collection), ...fields },
});

const goodOutput = (): ChatOutput => ({
  urgency: "TODAY",
  headline: "Call her doctor today about the arm pain and the tiredness.",
  answer: "The tiredness started after her metoprolol went up.\n\n- Her heart rate has been in the 50s.",
  connections: [
    { recordId: "MED-1", quote: "Changed dose 25 mg → 50 mg", likelihood: "LIKELY", explanation: "A higher beta-blocker dose often causes tiredness." },
    { recordId: "F1", quote: '"fatigue" was first logged', likelihood: "LIKELY", explanation: "The timing fits." },
  ],
  otherPossibilities: ["A viral illness"],
  followUpQuestions: ["Is the arm pain on the left side?"],
  proposals: [
    save("appointment", null, { title: "Call Dr. Rivera", specialty: "Cardiology", providerId: "PRV-2", bookBy: addDays(TODAY, 2), status: "TO_BOOK", relatedIds: ["MED-1", "F1"] }),
    save("checkIn", null, { symptoms: [{ name: "Arm pain", bodyArea: "left arm", severity: null }], note: "Arm still sore today" }),
    save("question", null, { text: "Could the higher metoprolol dose explain her tiredness?", appointmentId: "APT-3" }),
  ],
});

/** An answer stored before record changes existed. */
const legacyOutput = (): ChatOutput => ({
  ...goodOutput(),
  proposals: [
    { kind: "APPOINTMENT", title: "Call Dr. Rivera", specialty: "Cardiology", providerId: "PRV-2", bookWithinDays: 2, reason: "Tired since the dose change", relatedIds: ["MED-1"] },
    { kind: "CHECKIN", overall: null, energy: null, symptoms: [{ name: "Arm pain", bodyArea: "left arm", severity: null }], note: "Arm still sore today" },
    { kind: "QUESTION", text: "Could the higher metoprolol dose explain her tiredness?", appointmentId: "APT-3", relatedIds: ["MED-1"] },
  ],
});

function storedRun(state: HealthState, job: AiRun["job"], subjectId: string, output: unknown) {
  return addRun(state, {
    job,
    subjectId,
    recordRevision: state.revision,
    provider: "test",
    model: "test",
    status: "SUCCEEDED",
    reasons: [],
    warnings: [],
    output,
    floor: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
    startedAt: NOW,
    durationMs: 1,
  });
}

describe("sample and computed facts", () => {
  it("builds the sample through commands", () => {
    expect(sample.profile.sample).toBe(true);
    expect(sample.medications.find((m) => m.id === "MED-1")!.dose).toBe("50 mg");
  });
  it("links the new tiredness to the dose change, by code", () => {
    const facts = computeFacts(sample, TODAY);
    const timing = facts.find((f) => f.kind === "TIMING" && f.text.startsWith('"fatigue"'));
    expect(timing!.text).toBe(`"fatigue" was first logged on ${addDays(TODAY, -18)} (CHK-5), 8 days after Metoprolol succinate ER was changed (dose 25 mg → 50 mg) on ${addDays(TODAY, -26)} (MED-1).`);
    expect(facts.some((f) => f.kind === "VITALS" && f.text.startsWith("Heart rate was under 55"))).toBe(true);
    expect(facts.filter((f) => f.kind === "TIMING").length).toBeLessThanOrEqual(12);
    expect(facts.some((f) => f.text.startsWith("Vitamin B12 (TST-7) should be done every 12 months and has no result"))).toBe(true);
    expect(facts.some((f) => f.text.startsWith("Hemoglobin A1C (TST-1) is overdue by"))).toBe(true);
    expect(facts.some((f) => f.kind === "RESULT" && f.text.includes("Hemoglobin (RES-6) was 11.3 g/dL") && f.text.includes("LOW"))).toBe(true);
  });
  it("shows yesterday's arm pain with tiredness as a red flag on the overview", () => {
    const view = buildView(sample, TODAY, NOW);
    expect(view.recentFlags.map((f) => f.flags.level)).toContain("TODAY");
    expect(view.upcoming.map((a) => a.id)).toEqual(["APT-3", "APT-4"]);
    expect(view.toBook.map((a) => a.id)).toEqual(["APT-5"]);
    expect(view.dueTests.map((t) => t.test.id)).toEqual(expect.arrayContaining(["TST-1", "TST-7", "TST-8", "TST-2"]));
  });
});

describe("timing facts", () => {
  it("keeps the closest links when there are many, and treats a placeholder body area as none", () => {
    let state = sample;
    for (let i = 0; i < 14; i++) {
      state = applyCommand(state, { type: "save", collection: "checkIn", data: { at: `${addDays(TODAY, -2)}T0${i % 10}:00`, symptoms: [{ name: `Symptom ${i}`, bodyArea: "" }] } }, NOW).state;
    }
    state = applyCommand(state, { type: "save", collection: "checkIn", data: { at: `${addDays(TODAY, -1)}T20:00`, symptoms: [{ name: "Fatigue", bodyArea: "General" }] } }, NOW).state;
    const facts = computeFacts(state, TODAY);
    expect(facts.some((f) => f.text.startsWith('"fatigue" was first logged'))).toBe(true);
    expect(facts.some((f) => f.text.includes('"fatigue (general)"'))).toBe(false);
  });
});

describe("record rendering", () => {
  it("sends the whole record as JSON, with every id quotable and the numbers code computed", () => {
    const withExtras: HealthState = { ...sample, people: [{ login: "secret@example.com", name: "Sam", role: "CAREGIVER" }] };
    const record = renderRecord(withExtras, TODAY, NOW);
    const packet = JSON.parse(record.text.replace(/^<health_record format="json">\n/, "").replace(/\n<\/health_record>$/, "")) as Record<string, unknown>;
    expect(Object.keys(packet)).toEqual(expect.arrayContaining(["patient", "diet", "diagnoses", "medications", "tests", "results", "appointments", "checkIns", "meals", "providers", "computed"]));
    expect(record.items.get("MED-1")).toContain("Changed dose 25 mg → 50 mg");
    expect(record.items.get("RES-6")).toContain('"value": "11.3"');
    expect(record.text).toContain('"flag": "LOW"');
    expect(record.text).toContain('"id": "F1"');
    expect(record.text).toContain("(555) 010-2231");
    expect(record.items.get("PROFILE")).toContain('"age": 76');
    expect(record.text).not.toContain("secret@example.com");
    expect(record.text).not.toContain('"sample"');
  });
  it("matches quotes despite case, curly quotes and spacing", () => {
    expect(quoteFound("[MED-1] Metoprolol succinate ER 50 mg.", "metoprolol  SUCCINATE er")).toBe(true);
    expect(quoteFound("[MED-1] Metoprolol 50 mg.", "Metoprolol 100 mg")).toBe(false);
    expect(quoteFound('"fatigue" was first logged', "“fatigue” was first logged.")).toBe(true);
  });
  it("finds measurements that appear nowhere in the sources", () => {
    expect(unsupportedMeasurements("Her dose is 50 mg and her BP was 148/92.", ["dose 25 mg → 50 mg", "Blood pressure 148/90"])).toEqual(["148/92"]);
    expect(unsupportedMeasurements("Her visit is on 10/24.", ["nothing"])).toEqual([]);
  });
});

describe("chat", () => {
  it("builds a request from the stored record, with the red flags of the message", () => {
    const { request } = chatFor(sample, "She's feeling sluggish and weak and her left arm is hurting");
    expect(request.flags.level).toBe("TODAY");
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.content).toContain('<code_red_flags floor="TODAY">');
    expect(request.context).toContain("<health_record");
  });
  it("accepts an output whose citations and quotes are in the record", () => {
    const { request } = chatFor(sample, "She's feeling sluggish and weak and her left arm is hurting");
    const result = validateChat(goodOutput(), request, sample);
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe("SUCCEEDED");
  });
  it("refuses an urgency below the code floor", () => {
    const { request } = chatFor(sample, "Her arm hurts and she is sweaty");
    const result = validateChat({ ...goodOutput(), urgency: "SOON" }, request, sample);
    expect(result.status).toBe("INVALID");
    expect(result.reasons[0]).toMatch(/below the code red-flag floor EMERGENCY/);
  });
  it("refuses a quote that is not in the cited line, and a record that was not sent", () => {
    const { request } = chatFor(sample, "Why is she tired?");
    const bad = goodOutput();
    const result = validateChat(
      {
        ...bad,
        connections: [
          { recordId: "MED-1", quote: "Metoprolol 100 mg", likelihood: "LIKELY", explanation: "x" },
          { recordId: "MED-99", quote: "x", likelihood: "POSSIBLE", explanation: "x" },
        ],
      },
      request,
      sample,
    );
    expect(result.status).toBe("INVALID");
    expect(result.reasons).toEqual([
      'Connection 1 quote "Metoprolol 100 mg" is not in MED-1 as sent.',
      "Connection 2 cites MED-99, which was not sent to the model.",
    ]);
  });
  it("checks each proposed change on a copy of the record, refusing only the bad ones", () => {
    const { request } = chatFor(sample, "Why is she tired?");
    const output = goodOutput();
    const result = validateChat(
      {
        ...output,
        proposals: [
          save("appointment", null, { title: "Cardiology", providerId: "PRV-9" }),
          save("checkIn", null, { overall: 9 }),
          save("diagnosis", "MED-1", { status: "RESOLVED" }),
          { kind: "MYSTERY", id: null },
          ...output.proposals,
        ],
      },
      request,
      sample,
    );
    expect(result.status).toBe("SUCCEEDED");
    const checked = result.output as ChatOutput;
    expect(checked.proposals).toHaveLength(6);
    expect(checked.checks!.map((c) => c.ok)).toEqual([false, false, false, true, true, true]);
    expect(checked.checks![0]!.reasons).toEqual(["Doctor: PRV-9 is not a provider in the record."]);
    expect(checked.checks![2]!.reasons).toEqual(["MED-1 is a medication, not a diagnosis."]);
    expect(result.warnings).toEqual(["Suggestion 4 could not be read and was left out"]);
    expect(sample.appointments).toHaveLength(5);
  });
  it("warns about a measurement the record does not hold", () => {
    const { request } = chatFor(sample, "Why is she tired?");
    const result = validateChat({ ...goodOutput(), answer: "Her dose is 75 mg now." }, request, sample);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.warnings[0]).toMatch(/"75mg"/);
  });
  it("shows the first items of an overlong list, with a warning, instead of refusing the answer", () => {
    const { request } = chatFor(sample, "Why is she tired?");
    const output = goodOutput();
    const result = validateChat({ ...output, followUpQuestions: ["a", "b", "c", "d", "e", "f"] }, request, sample);
    expect(result.status).toBe("SUCCEEDED");
    expect((result.output as ChatOutput).followUpQuestions).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.warnings).toEqual(["The answer had 6 follow-up questions; the first 5 are shown."]);
  });
  it("tells the model who is asking, the patient or a caregiver", () => {
    const started = startThread(sample, "My arm hurts", NOW);
    let state = appendMessage(started.state, started.threadId, { role: "user", text: "My arm hurts", runId: null, by: "Mom", byRole: "PATIENT" }, NOW);
    const thread = state.threads.find((t) => t.id === started.threadId)!;
    const request = buildChatRequest(state, thread, TODAY, NOW);
    expect(request.messages.at(-1)!.content).toContain('<asker name="Mom" role="patient" />');
    expect(thread.messages[0]).toMatchObject({ by: "Mom", byRole: "PATIENT" });
    state = appendMessage(state, started.threadId, { role: "user", text: "Old style", runId: null }, NOW);
    expect(buildChatRequest(state, state.threads.find((t) => t.id === started.threadId)!, TODAY, NOW).messages.at(-1)!.content).toContain('<asker role="caregiver" />');
  });
  it("keeps the history alternating and starting with the person", () => {
    let { state, thread } = chatFor(sample, "First question");
    state = appendMessage(state, thread.id, { role: "user", text: "Second question", runId: null }, NOW);
    thread = state.threads.find((t) => t.id === thread.id)!;
    const request = buildChatRequest(state, thread, TODAY, NOW);
    expect(request.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("decisions", () => {
  it("turns accepted changes into records marked as AI, once", () => {
    const { state } = chatFor(sample, "x");
    const { state: withRun, runId } = storedRun(state, "CHAT", "THR-1", validateChat(goodOutput(), chatFor(sample, "x").request, sample).output);
    let next = decideProposal(withRun, runId, 0, "ACCEPT", {}, NOW, "Sam");
    const appointment = next.state.appointments.find((a) => a.id === next.createdIds[0])!;
    expect(appointment).toMatchObject({ status: "TO_BOOK", bookBy: addDays(TODAY, 2), providerId: "PRV-2", source: "AI", aiRunId: runId, relatedIds: ["MED-1"] });
    next = decideProposal(next.state, runId, 1, "ACCEPT", { note: "Edited by me" }, NOW, "Sam");
    expect(next.state.checkIns.find((c) => c.id === next.createdIds[0])).toMatchObject({ note: "Edited by me", source: "AI", by: "Sam" });
    next = decideProposal(next.state, runId, 2, "DISMISS", {}, NOW);
    expect(next.createdIds).toEqual([]);
    expect(() => decideProposal(next.state, runId, 2, "ACCEPT", {}, NOW)).toThrow(/already decided/);
    expect(next.state.aiRuns.find((r) => r.id === runId)!.decisions.map((d) => d.decision)).toEqual(["ACCEPTED", "ACCEPTED", "DISMISSED"]);
  });
  it("still applies suggestions from answers stored before record changes existed", () => {
    const { state } = chatFor(sample, "x");
    const { state: withRun, runId } = storedRun(state, "CHAT", "THR-1", legacyOutput());
    let next = decideProposal(withRun, runId, 0, "ACCEPT", {}, NOW);
    expect(next.state.appointments.find((a) => a.id === next.createdIds[0])).toMatchObject({ status: "TO_BOOK", bookBy: addDays(TODAY, 2), providerId: "PRV-2" });
    next = decideProposal(next.state, runId, 2, "ACCEPT", { text: "Edited question" }, NOW);
    expect(next.state.questions.find((q) => q.id === next.createdIds[0])).toMatchObject({ text: "Edited question", appointmentId: "APT-3", relatedIds: ["MED-1"] });
  });
  it("refuses to apply a change that failed its check", () => {
    const { state } = chatFor(sample, "x");
    const output = validateChat({ ...goodOutput(), proposals: [save("checkIn", null, { overall: 9 })] }, chatFor(sample, "x").request, sample).output;
    const { state: withRun, runId } = storedRun(state, "CHAT", "THR-1", output);
    expect(() => decideProposal(withRun, runId, 0, "ACCEPT", {}, NOW)).toThrow(/cannot be applied/);
  });
});

describe("linked changes in one answer", () => {
  it("sets up linked records with #N references, checked in order and resolved on apply", () => {
    const empty = { ...sample, providers: [], diagnoses: [], medications: [], appointments: [], tests: [], results: [], checkIns: [], questions: [] };
    const { state, request } = chatFor(empty, "Set up her record");
    const proposals = [
      save("diagnosis", null, { name: "Atrial fibrillation" }),
      save("medication", null, { name: "Eliquis", dose: "5 mg", diagnosisIds: ["#1"] }),
      save("provider", null, { name: "Dr. Rivera", specialty: "Cardiology" }),
      save("appointment", null, { title: "Cardiology", start: `${addDays(TODAY, 10)}T14:00`, providerId: "#3" }),
      save("appointment", null, { title: "Bad", providerId: "#9" }),
      save("profile", "PROFILE", { allergies: ["Penicillin"] }),
    ];
    const result = validateChat({ ...goodOutput(), connections: [], proposals }, request, empty);
    const output = result.output as ChatOutput;
    expect(output.checks!.map((c) => c.ok)).toEqual([true, true, true, true, false, true]);
    expect(output.checks![4]!.reasons).toEqual(["It points at suggestion 9, which comes after it."]);
    const { state: withRun, runId } = storedRun(state, "CHAT", "THR-1", output);
    expect(() => decideProposal(withRun, runId, 3, "ACCEPT", {}, NOW)).toThrow(/Apply suggestion 3 first/);
    let next = withRun;
    for (const i of [0, 1, 2, 3, 5]) next = decideProposal(next, runId, i, "ACCEPT", {}, NOW).state;
    const dx = next.diagnoses.find((d) => d.name === "Atrial fibrillation")!;
    const doctor = next.providers.find((p) => p.name === "Dr. Rivera")!;
    expect(next.medications.find((m) => m.name === "Eliquis")!.diagnosisIds).toEqual([dx.id]);
    expect(next.appointments.find((a) => a.title === "Cardiology")!.providerId).toBe(doctor.id);
    expect(next.profile.allergies).toEqual(["Penicillin"]);
  });
});

describe("diet and weight", () => {
  const withWeights = () => {
    let state = sample;
    const log = (days: number, lb: string) => {
      state = applyCommand(state, { type: "save", collection: "checkIn", data: { at: `${addDays(TODAY, days)}T08:00`, weightLb: lb } }, NOW).state;
    };
    log(-185, "172.0");
    log(-90, "172.4");
    log(-31, "178.6");
    log(-1, "180.2");
    return applyCommand(state, { type: "diet.save", diet: { goalWeightLb: "170", goalDate: addDays(TODAY, 140), plan: "Smaller dinners, walk after lunch" } }, NOW).state;
  };
  it("works out the change over 6 months and 30 days, and the goal, exactly", () => {
    const summary = dietSummary(withWeights(), TODAY);
    expect(summary.latest!.lb).toBe("180.2");
    expect(summary.sixMonths).toMatchObject({ change: "+8.2", perWeek: "+0.3" });
    expect(summary.thirtyDays).toMatchObject({ change: "+1.6" });
    expect(summary.goal).toMatchObject({ lb: "170", toGo: "10.2", weeksLeft: 20, perWeekNeeded: "0.5" });
    const facts = computeFacts(withWeights(), TODAY).filter((f) => f.kind === "WEIGHT");
    expect(facts[0]!.text).toContain("changed +8.2 lb, about +0.3 lb a week");
  });
  it("counts a reading a few days after the 6-month mark, and falls back to the first reading", () => {
    let state = sample;
    const log = (days: number, lb: string) => {
      state = applyCommand(state, { type: "save", collection: "checkIn", data: { at: `${addDays(TODAY, days)}T08:00`, weightLb: lb } }, NOW).state;
    };
    log(-60, "175.0");
    log(-3, "180.2");
    let summary = dietSummary(state, TODAY);
    expect(summary.sixMonths).toBeNull();
    expect(summary.sinceFirst).toMatchObject({ change: "+5.2" });
    log(-182, "172.0");
    summary = dietSummary(state, TODAY);
    expect(summary.sixMonths).toMatchObject({ change: "+8.2" });
  });
  it("lets the chat log a meal and set the goal", () => {
    const next = applyAll(sample, [
      ...changeToCommands(sample, save("meal", null, { at: TODAY, kind: "BREAKFAST", description: "Oatmeal with berries" })),
      ...changeToCommands(sample, save("diet", "DIET", { goalWeightLb: "160" })),
    ], NOW).state;
    expect(next.meals[0]).toMatchObject({ at: `${TODAY}T12:00`, kind: "BREAKFAST", description: "Oatmeal with berries" });
    expect(next.diet.goalWeightLb).toBe("160");
    expect(renderRecord(next, TODAY, NOW).items.get("DIET")).toContain('"goalWeightLb": "160"');
  });
});

describe("record changes from a chat", () => {
  const run = (state: HealthState, change: ChangeProposal, edits = {}) => applyAll(state, changeToCommands(state, change, edits), NOW).state;

  it("updates only the fields given, and dates a dose change", () => {
    const next = run(sample, save("medication", "MED-1", { dose: "25 mg", changedOn: addDays(TODAY, -2) }));
    const med = next.medications.find((m) => m.id === "MED-1")!;
    expect(med).toMatchObject({ dose: "25 mg", instructions: "1 tablet every morning", prescriberId: "PRV-2", diagnosisIds: ["DX-3", "DX-1"] });
    expect(med.history.at(-1)).toMatchObject({ at: `${addDays(TODAY, -2)}T00:00`, note: "Changed dose 50 mg → 25 mg" });
  });
  it("books a visit that was to be booked", () => {
    const next = run(sample, save("appointment", "APT-5", { start: `${addDays(TODAY, 9)}T14:00` }));
    expect(next.appointments.find((a) => a.id === "APT-5")).toMatchObject({ status: "SCHEDULED", start: `${addDays(TODAY, 9)}T14:00`, providerId: "PRV-4" });
  });
  it("adds a result for a test that is not tracked yet, creating the test", () => {
    const next = run(sample, save("result", null, { testName: "Ferritin", unit: "ng/mL", refLow: "30", refHigh: "400", date: TODAY, value: "14" }));
    const ferritin = next.tests.find((t) => t.name === "Ferritin")!;
    expect(ferritin).toMatchObject({ unit: "ng/mL", refLow: "30", refHigh: "400" });
    expect(next.results.find((r) => r.testId === ferritin.id)).toMatchObject({ value: "14", date: TODAY });
    const again = run(next, save("result", null, { testName: "ferritin", date: TODAY, value: "15" }));
    expect(again.tests.filter((t) => t.name === "Ferritin")).toHaveLength(1);
  });
  it("changes a status, deletes, and edits the profile", () => {
    let next = run(sample, { kind: "STATUS", collection: "medication", id: "MED-5", status: "STOPPED", at: TODAY, note: "Muscle aches", outcome: null, answer: null, summary: "Stop atorvastatin" });
    expect(next.medications.find((m) => m.id === "MED-5")!.history.at(-1)).toMatchObject({ to: "STOPPED", note: "Muscle aches" });
    next = run(next, { kind: "DELETE", collection: "checkIn", id: "CHK-1", summary: "Delete" });
    expect(next.checkIns.some((c) => c.id === "CHK-1")).toBe(false);
    next = run(next, save("profile", null, { allergies: ["Penicillin (hives)", "Sulfa (rash)"] }));
    expect(next.profile).toMatchObject({ name: "Sample patient", allergies: ["Penicillin (hives)", "Sulfa (rash)"], sample: true });
  });
  it("keeps a check-in with a date but no time at midday", () => {
    const next = run(sample, save("checkIn", null, { at: TODAY, bpSys: 128, bpDia: 80 }));
    expect(next.checkIns.at(-1)).toMatchObject({ at: `${TODAY}T12:00`, bpSys: 128, bpDia: 80 });
  });
  it("adds a new test with how often it repeats", () => {
    const next = run(sample, save("test", null, { name: "INR", unit: "", frequencyEvery: 4, frequencyUnit: "WEEK" }));
    expect(next.tests.find((t) => t.name === "INR")!.frequency).toEqual({ every: 4, unit: "WEEK" });
  });
});

const DOC = `After Visit Summary - Maple Family Medicine
Date: 10/16/2026
Labs: Hemoglobin A1C 7.8 % (ref 4.0-5.6). Ferritin 18 ng/mL (ref 30-400).
Medication changes: INCREASE Metformin to 1000 mg twice daily. STOP Atorvastatin 40 mg.
Follow up with cardiology in 2 weeks.`;

describe("document extraction", () => {
  const { state, docId } = addImportDoc(sample, { label: "Visit summary", date: "2026-10-16", text: DOC }, NOW);
  const doc = state.imports.find((d) => d.id === docId)!;
  const raw = {
    summary: "A1C rose. Iron stores are low.",
    documentDate: "2026-10-16",
    items: [
      { kind: "RESULT", testName: "Hemoglobin A1C", matchesTestId: "TST-1", value: "7.8", unit: "%", refLow: "4.0", refHigh: "5.6", date: "2026-10-16", span: "Hemoglobin A1C 7.8 % (ref 4.0-5.6)" },
      { kind: "RESULT", testName: "Ferritin", matchesTestId: null, value: "18", unit: "ng/mL", refLow: "30", refHigh: "400", date: null, span: "Ferritin 18 ng/mL (ref 30-400)" },
      { kind: "MEDICATION", name: "Atorvastatin", dose: "40 mg", instructions: "", change: "STOPPED", matchesMedicationId: "MED-5", span: "STOP Atorvastatin 40 mg" },
      { kind: "RESULT", testName: "TSH", matchesTestId: "TST-2", value: "3.1", unit: "mIU/L", refLow: null, refHigh: null, date: null, span: "TSH 3.1" },
      { kind: "APPOINTMENT", title: "Cardiology follow-up", specialty: "Cardiology", start: null, bookWithinDays: 14, span: "Follow up with cardiology in 2 weeks." },
      { kind: "MEDICATION", name: "Metformin", dose: "1000 mg", instructions: "twice daily", change: "CONTINUED", matchesMedicationId: "MED-3", span: "Metformin to 1000 mg twice daily" },
    ],
  };

  it("refuses an item whose quote is not in the document, and keeps the others", () => {
    const result = validateExtract(raw, doc, state);
    expect(result.status).toBe("SUCCEEDED");
    const output = result.output as ExtractOutput;
    expect(output.items.map((i) => i.ok)).toEqual([true, true, true, false, true, true]);
    expect(output.items[3]!.reasons).toEqual(["Its quote is not in the document."]);
  });
  it("refuses a value that is not in its own quote", () => {
    const result = validateExtract({ ...raw, items: [{ ...raw.items[0], value: "7.9" }] }, doc, state);
    expect(result.status).toBe("INVALID");
  });
  it("creates a new test for a new result, and stops a medication, on accept", () => {
    const output = validateExtract(raw, doc, state).output as ExtractOutput;
    const { state: withRun, runId } = storedRun(state, "EXTRACT", docId, output);
    let next = decideProposal(withRun, runId, 1, "ACCEPT", {}, NOW);
    const ferritin = next.state.tests.find((t) => t.name === "Ferritin")!;
    expect(next.state.results.find((r) => r.testId === ferritin.id)).toMatchObject({ value: "18", date: "2026-10-16", source: "AI" });
    next = decideProposal(next.state, runId, 2, "ACCEPT", {}, NOW);
    expect(next.state.medications.find((m) => m.id === "MED-5")!.status).toBe("STOPPED");
    expect(next.state.aiRuns.find((r) => r.id === runId)!.decisions.at(-1)!.updatedIds).toEqual(["MED-5"]);
    expect(() => decideProposal(next.state, runId, 3, "ACCEPT", {}, NOW)).toThrow(/Code refused this item/);
    next = decideProposal(next.state, runId, 4, "ACCEPT", {}, NOW);
    expect(next.state.appointments.find((a) => a.id === next.createdIds[0])).toMatchObject({ status: "TO_BOOK", bookBy: "2026-10-30" });
    const before = next.state.medications.find((m) => m.id === "MED-3")!;
    next = decideProposal(next.state, runId, 5, "ACCEPT", {}, NOW);
    expect(next.state.medications.find((m) => m.id === "MED-3")).toEqual(before);
  });
});

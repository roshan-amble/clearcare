import { dietSummary } from "../diet.js";
import type { DocPacket } from "../documents.js";
import { computeFacts } from "../facts.js";
import { profileSummary } from "../profile.js";
import { summarizeTest } from "../results.js";
import type { HealthState, LocalDate, LocalDateTime } from "../types.js";

/**
 * What the model reads: her whole health record as one JSON packet, plus a "computed" section with every number code
 * worked out (facts, flags, due dates, weight trends). Every record carries its id, and a quote is checked against
 * that record's JSON exactly as sent, so the model can only quote what it was given.
 *
 * Left out, as bookkeeping rather than health data: past AI runs (the model's own earlier answers), the chats (sent
 * as the conversation), the Tailscale logins of who may use the app, and internal counters.
 */
export interface RenderedRecord {
  readonly text: string;
  /** Each id's JSON as sent, for quote checks. Computed facts map to their sentence. */
  readonly items: ReadonlyMap<string, string>;
  readonly revision: number;
}

const json = (value: unknown): string => JSON.stringify(value, null, 1);

/**
 * Documents: every upload is listed with what code read from it (title, visit date, doctor, place, reason,
 * diagnoses); the text of the ones that matter comes with it (see chooseDocuments). Without a packet, the listing
 * alone is sent.
 */
export function renderRecord(state: HealthState, today: LocalDate, now: LocalDateTime, docs: DocPacket | null = null): RenderedRecord {
  const { sample: _sample, ...profile } = state.profile;
  const summary = profileSummary(state, today);
  const patient = {
    id: "PROFILE",
    ...profile,
    computed: { age: summary.age, ageApproximate: summary.ageApproximate, height: summary.heightText, latestWeightLb: summary.latestWeightLb, bmi: summary.bmi },
  };
  const diet = { id: "DIET", ...state.diet };
  const facts = computeFacts(state, today);
  const tests = state.tests.map((t) => summarizeTest(state, t, today));
  const packet = {
    about:
      "ClearCare health record for one person. Every record has an id. Results belong to tests by testId; a lab result has a value, a scan or biopsy result has a report (impression, findings, the documents it came in). Check-ins hold symptoms, vital signs and weight. Documents are her uploads, read by code: textSent says whether their text is below in full, in part, or not at all. The computed section holds numbers worked out by code from this record.",
    today,
    now,
    revision: state.revision,
    patient,
    diet,
    diagnoses: state.diagnoses,
    medications: state.medications,
    tests: state.tests,
    results: state.results,
    appointments: state.appointments,
    questions: state.questions,
    checkIns: state.checkIns,
    meals: state.meals,
    providers: state.providers,
    documents:
      docs?.documents ??
      state.files.map((f) => ({ id: f.id, name: f.name, title: f.read?.title ?? f.name, date: f.read?.date ?? null, visit: f.read?.summary ?? "", textSent: "NONE" as const })),
    pastedDocuments: state.imports.map(({ id, label, date, text, createdAt }) => ({ id, label, date, text, createdAt })),
    computed: {
      facts,
      tests: tests.map((s) => ({
        testId: s.test.id,
        latestResultId: s.latest?.id ?? null,
        flag: s.flag,
        changeFromPrevious: s.delta,
        due: s.due === null ? null : { state: s.due.state, nextDate: s.due.nextDate, daysUntil: s.due.daysUntil },
      })),
      weight: dietSummary(state, today),
    },
  };

  const items = new Map<string, string>();
  items.set("PROFILE", json(patient));
  items.set("DIET", json(diet));
  for (const list of [state.diagnoses, state.medications, state.tests, state.results, state.appointments, state.questions, state.checkIns, state.meals, state.providers] as const) {
    for (const record of list as readonly { readonly id: string }[]) items.set(record.id, json(record));
  }
  for (const doc of packet.documents as readonly { readonly id: string }[]) items.set(doc.id, json(doc));
  for (const doc of packet.pastedDocuments) items.set(doc.id, json(doc));
  for (const fact of facts) items.set(fact.id, fact.text);

  return { text: `<health_record format="json">\n${json(packet)}\n</health_record>`, items, revision: state.revision };
}

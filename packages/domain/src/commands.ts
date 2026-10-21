import * as check from "./check.js";
import { compare, parseDecimal } from "./decimal.js";
import { DomainError, invalid, notFound } from "./errors.js";
import { dateAtPrecision, isReportTest, readPartialDate } from "./results.js";
import {
  APPOINTMENT_STATUSES,
  BLOOD_TYPES,
  DATE_PRECISIONS,
  DIAGNOSIS_STATUSES,
  FREQUENCY_UNITS,
  MEDICATION_STATUSES,
  PREFIX,
  MEAL_KINDS,
  QUESTION_STATUSES,
  ROLES,
  TEST_KINDS,
  TRACK_STATUSES,
  type Appointment,
  type CheckIn,
  type Diagnosis,
  type HealthState,
  type LocalDateTime,
  type DietGoal,
  type Meal,
  type Medication,
  type Person,
  type Profile,
  type Provider,
  type Question,
  type Result,
  type Sex,
  type Source,
  type StatusChange,
  type Symptom,
  type Test,
} from "./types.js";

/**
 * Commands are the only way the record changes. Each one is checked here, in tested code, before it is stored. A
 * command never carries its own source: the server sets PERSON, and only an accepted AI proposal sets AI.
 */

export const COLLECTIONS = ["provider", "appointment", "medication", "diagnosis", "test", "result", "checkIn", "question", "meal"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const STATUS_COLLECTIONS = ["appointment", "medication", "diagnosis", "test", "question"] as const;
export type StatusCollection = (typeof STATUS_COLLECTIONS)[number];
export const DELETE_COLLECTIONS = [...COLLECTIONS, "thread", "importDoc"] as const;
export type DeleteCollection = (typeof DELETE_COLLECTIONS)[number];

export type Command =
  | { readonly type: "profile.save"; readonly profile: unknown }
  /** Only from this computer: the server refuses it from anyone signed in through Tailscale. */
  | { readonly type: "people.save"; readonly people: unknown }
  | { readonly type: "diet.save"; readonly diet: unknown }
  | { readonly type: "save"; readonly collection: Collection; readonly id?: string | null; readonly data: unknown }
  | {
      readonly type: "status";
      readonly collection: StatusCollection;
      readonly id: string;
      readonly status: string;
      readonly note?: string;
      /** When the change happened, if not now. */
      readonly at?: string | null;
      /** Visit notes, when an appointment is completed. */
      readonly outcome?: string;
      /** The doctor's answer, when a question is marked asked. */
      readonly answer?: string;
    }
  | { readonly type: "delete"; readonly collection: DeleteCollection; readonly id: string };

export interface Meta {
  readonly source: Source;
  readonly aiRunId: string | null;
  /** The name of the person who made the change, when known. */
  readonly by?: string | null;
}

export const PERSON: Meta = { source: "PERSON", aiRunId: null };

export interface Applied {
  readonly state: HealthState;
  readonly createdIds: readonly string[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft = Mutable<HealthState>;

const ARRAY_OF: Record<Collection, keyof HealthState> = {
  provider: "providers",
  appointment: "appointments",
  medication: "medications",
  diagnosis: "diagnoses",
  test: "tests",
  result: "results",
  checkIn: "checkIns",
  question: "questions",
  meal: "meals",
};

const PREFIX_OF: Record<Collection, string> = {
  provider: PREFIX.provider,
  appointment: PREFIX.appointment,
  medication: PREFIX.medication,
  diagnosis: PREFIX.diagnosis,
  test: PREFIX.test,
  result: PREFIX.result,
  checkIn: PREFIX.checkIn,
  question: PREFIX.question,
  meal: PREFIX.meal,
};

/** Takes the next number for an ID prefix. */
export function takeId(draft: Draft, prefix: string): string {
  const next = (draft.counters[prefix] ?? 0) + 1;
  draft.counters = { ...draft.counters, [prefix]: next };
  return `${prefix}-${next}`;
}

/** Finds any record by ID, whatever its kind. */
export function findRecord(state: HealthState, id: string): { readonly collection: Collection; readonly record: { readonly id: string } } | null {
  for (const collection of COLLECTIONS) {
    const records = state[ARRAY_OF[collection]] as readonly { readonly id: string }[];
    const record = records.find((r) => r.id === id);
    if (record !== undefined) return { collection, record };
  }
  return null;
}

function ref(state: HealthState, value: unknown, field: string, collection: Collection): string | null {
  const id = check.optionalText(value, field, 40);
  if (id === null) return null;
  const found = findRecord(state, id);
  if (found === null || found.collection !== collection) throw invalid(`${field}: ${id} is not a ${collection} in the record.`);
  return id;
}

function refs(state: HealthState, value: unknown, field: string, allowed: readonly Collection[]): string[] {
  const ids = check.textList(value, field, 30);
  for (const id of ids) {
    const found = findRecord(state, id);
    if (found === null || !allowed.includes(found.collection)) throw invalid(`${field}: ${id} is not in the record.`);
  }
  return [...new Set(ids)];
}

function obj(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

const RELATED: readonly Collection[] = ["appointment", "medication", "diagnosis", "test", "result", "checkIn", "question", "provider"];

// ---------------------------------------------------------------------------------------------------------------
// Normalizers: unknown input to a checked record body.

export function normalizeProfile(input: unknown, sample: boolean, state?: HealthState): Profile {
  const data = obj(input, "Profile");
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  const sex = blank(data["sex"]) ? null : check.oneOf<Sex>(data["sex"], "Sex", ["FEMALE", "MALE", "OTHER"]);
  const birthDate = check.date(data["birthDate"], "Birth date");
  const heightIn = check.decimalText(data["heightIn"], "Height");
  if (heightIn !== null && (Number(heightIn) < 36 || Number(heightIn) > 96)) throw invalid("Height must be between 3 and 8 feet.");
  return {
    name: check.text(data["name"], "Name", { required: true, max: 80 }),
    birthYear: birthDate === null ? check.integer(data["birthYear"], "Birth year", 1900, 2030) : Number(birthDate.slice(0, 4)),
    birthDate,
    sex,
    heightIn,
    bloodType: blank(data["bloodType"]) ? null : check.oneOf(data["bloodType"], "Blood type", BLOOD_TYPES),
    allergies: check.textList(data["allergies"], "Allergies"),
    primaryProviderId: state === undefined ? check.optionalText(data["primaryProviderId"], "Primary doctor", 40) : ref(state, data["primaryProviderId"], "Primary doctor", "provider"),
    pharmacy: check.text(data["pharmacy"], "Pharmacy", { max: 300 }),
    preferredHospital: check.text(data["preferredHospital"], "Preferred hospital", { max: 300 }),
    mobility: check.text(data["mobility"], "Mobility and aids", { max: 500 }),
    livingSituation: check.text(data["livingSituation"], "Living situation", { max: 500 }),
    lifestyle: check.text(data["lifestyle"], "Lifestyle", { max: 1000 }),
    advanceDirective: check.text(data["advanceDirective"], "Advance directive", { max: 500 }),
    healthcareProxy: check.text(data["healthcareProxy"], "Healthcare proxy", { max: 300 }),
    emergencyContact: check.text(data["emergencyContact"], "Emergency contact", { max: 300 }),
    insurance: check.text(data["insurance"], "Insurance", { max: 300 }),
    notes: check.text(data["notes"], "Notes"),
    sample,
  };
}

/** Tailscale logins look like an email address, or a name followed by @github and the like. */
export function normalizePeople(input: unknown): Person[] {
  const people = check.list(input, "People", 12).map((value, i) => {
    const data = obj(value, `Person ${i + 1}`);
    const login = check.text(data["login"], `Person ${i + 1} Tailscale login`, { required: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(login)) throw invalid(`Person ${i + 1}: "${login}" is not a Tailscale login, such as name@gmail.com.`);
    return {
      login,
      name: check.text(data["name"], `Person ${i + 1} name`, { required: true, max: 60 }),
      role: check.oneOf(data["role"], `Person ${i + 1} role`, ROLES),
    };
  });
  const seen = new Set<string>();
  for (const person of people) {
    if (seen.has(person.login)) throw invalid(`${person.login} is listed twice.`);
    seen.add(person.login);
  }
  return people;
}

export function normalizeDiet(input: unknown): DietGoal {
  const data = obj(input, "Diet");
  return {
    goalWeightLb: check.decimalText(data["goalWeightLb"], "Goal weight"),
    goalDate: check.date(data["goalDate"], "Goal date"),
    plan: check.text(data["plan"], "Plan"),
  };
}

function normalizeMeal(data: Record<string, unknown>, now: LocalDateTime) {
  return {
    at: check.dateTime(data["at"], "When") ?? (typeof data["at"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data["at"]) ? `${data["at"]}T12:00` : now),
    kind: data["kind"] === undefined || data["kind"] === null || data["kind"] === "" ? "SNACK" : check.oneOf(data["kind"], "Meal", MEAL_KINDS),
    description: check.text(data["description"], "What she ate", { required: true, max: 500 }),
    note: check.text(data["note"], "Note", { max: 500 }),
  };
}

function normalizeProvider(data: Record<string, unknown>): Omit<Provider, "id"> {
  return {
    name: check.text(data["name"], "Name", { required: true, max: 120 }),
    specialty: check.text(data["specialty"], "Specialty", { max: 80 }),
    phone: check.text(data["phone"], "Phone", { max: 60 }),
    address: check.text(data["address"], "Address", { max: 300 }),
    notes: check.text(data["notes"], "Notes"),
  };
}

function normalizeAppointment(state: HealthState, data: Record<string, unknown>, existing: Appointment | null) {
  const start = check.dateTime(data["start"], "Date and time");
  const status = data["status"] === undefined || data["status"] === null || data["status"] === ""
    ? existing?.status ?? (start === null ? "TO_BOOK" : "SCHEDULED")
    : check.oneOf(data["status"], "Status", APPOINTMENT_STATUSES);
  if (status === "SCHEDULED" && start === null) throw invalid("A scheduled appointment needs a date and time.");
  if (status === "COMPLETED" && start === null) throw invalid("A completed appointment needs the date and time it happened.");
  return {
    title: check.text(data["title"], "Reason for the visit", { required: true, max: 200 }),
    providerId: ref(state, data["providerId"], "Doctor", "provider"),
    specialty: check.text(data["specialty"], "Specialty", { max: 80 }),
    start,
    bookBy: check.date(data["bookBy"], "Book by"),
    location: check.text(data["location"], "Location", { max: 300 }),
    status,
    prep: check.text(data["prep"], "Preparation"),
    outcome: check.text(data["outcome"], "Visit notes"),
    relatedIds: refs(state, data["relatedIds"], "Related records", RELATED),
    fileIds: fileRefs(state, data["fileIds"]),
  };
}

function normalizeMedication(state: HealthState, data: Record<string, unknown>, existing: Medication | null) {
  return {
    name: check.text(data["name"], "Medication name", { required: true, max: 120 }),
    dose: check.text(data["dose"], "Dose", { max: 80 }),
    instructions: check.text(data["instructions"], "Instructions", { max: 300 }),
    timesPerDay: check.integer(data["timesPerDay"], "Times per day", 0, 24),
    asNeeded: check.bool(data["asNeeded"]),
    purpose: check.text(data["purpose"], "What it is for", { max: 200 }),
    diagnosisIds: refs(state, data["diagnosisIds"], "Diagnoses", ["diagnosis"]),
    prescriberId: ref(state, data["prescriberId"], "Prescriber", "provider"),
    startDate: check.date(data["startDate"], "Start date"),
    refillDue: check.date(data["refillDue"], "Refill due"),
    status: data["status"] === undefined || data["status"] === null || data["status"] === ""
      ? existing?.status ?? "ACTIVE"
      : check.oneOf(data["status"], "Status", MEDICATION_STATUSES),
    notes: check.text(data["notes"], "Notes"),
  };
}

function normalizeDiagnosis(state: HealthState, data: Record<string, unknown>, existing: Diagnosis | null) {
  return {
    name: check.text(data["name"], "Diagnosis", { required: true, max: 200 }),
    diagnosedOn: check.date(data["diagnosedOn"], "Diagnosed on"),
    status: data["status"] === undefined || data["status"] === null || data["status"] === ""
      ? existing?.status ?? "ACTIVE"
      : check.oneOf(data["status"], "Status", DIAGNOSIS_STATUSES),
    providerId: ref(state, data["providerId"], "Doctor", "provider"),
    notes: check.text(data["notes"], "Notes"),
  };
}

function normalizeTest(state: HealthState, data: Record<string, unknown>, existing: Test | null) {
  const refLow = check.decimalText(data["refLow"], "Reference low");
  const refHigh = check.decimalText(data["refHigh"], "Reference high");
  if (refLow !== null && refHigh !== null) {
    const low = parseDecimal(refLow);
    const high = parseDecimal(refHigh);
    if (low !== null && high !== null && compare(low.value, high.value) > 0) throw invalid("Reference low is above reference high.");
  }
  let frequency: Test["frequency"] = null;
  const f = data["frequency"];
  if (f !== undefined && f !== null) {
    const fo = obj(f, "Frequency");
    const every = check.integer(fo["every"], "Repeat every", 1, 120);
    if (every !== null) frequency = { every, unit: check.oneOf(fo["unit"], "Repeat unit", FREQUENCY_UNITS) };
  }
  return {
    name: check.text(data["name"], "Test name", { required: true, max: 120 }),
    kind: data["kind"] === undefined || data["kind"] === null || data["kind"] === "" ? existing?.kind ?? "LAB" : check.oneOf(data["kind"], "Kind", TEST_KINDS),
    unit: check.text(data["unit"], "Unit", { max: 40 }),
    refLow,
    refHigh,
    frequency,
    diagnosisIds: refs(state, data["diagnosisIds"], "Diagnoses", ["diagnosis"]),
    status: data["status"] === undefined || data["status"] === null || data["status"] === ""
      ? existing?.status ?? "ACTIVE"
      : check.oneOf(data["status"], "Status", TRACK_STATUSES),
    notes: check.text(data["notes"], "Notes"),
  };
}

function normalizeResult(state: HealthState, data: Record<string, unknown>) {
  const testId = ref(state, data["testId"], "Test", "test");
  if (testId === null) throw invalid("Test is required.");
  const test = state.tests.find((t) => t.id === testId)!;
  const report = isReportTest(test);
  const parsed = readPartialDate(data["date"]);
  if (parsed === null) throw invalid(report ? "Date is required. When only the month is known, give the month, such as 2026-03." : "Date is required.");
  const given = data["datePrecision"];
  const precision = given === undefined || given === null || given === "" ? parsed.precision : check.oneOf(given, "Date precision", DATE_PRECISIONS);
  const value = check.text(data["value"], "Value", { required: !report, max: 200 });
  const impression = check.text(data["impression"], "Impression", { max: 6000 });
  const findings = check.text(data["findings"], "Findings", { max: 40000 });
  const fileIds = fileRefs(state, data["fileIds"]);
  if (report && value === "" && impression === "" && findings === "" && fileIds.length === 0) {
    throw invalid("A report needs at least one of: its impression, its findings, a short result, or the document it came in.");
  }
  return {
    testId,
    date: dateAtPrecision(parsed.date, precision),
    ...(precision === "DAY" ? {} : { datePrecision: precision }),
    value,
    impression,
    findings,
    facility: check.text(data["facility"], "Facility", { max: 200 }),
    providerId: ref(state, data["providerId"], "Doctor", "provider"),
    fileIds,
    note: check.text(data["note"], "Note", { max: 4000 }),
  };
}

/** Uploaded documents named by ID. */
function fileRefs(state: HealthState, value: unknown): string[] {
  const ids = check.textList(value, "Documents", 40);
  for (const id of ids) if (!state.files.some((f) => f.id === id)) throw invalid(`Documents: ${id} is not an uploaded document.`);
  return [...new Set(ids)];
}

function normalizeSymptom(value: unknown, i: number): Symptom {
  const data = obj(value, `Symptom ${i + 1}`);
  return {
    name: check.text(data["name"], `Symptom ${i + 1}`, { required: true, max: 120 }),
    bodyArea: check.text(data["bodyArea"], `Symptom ${i + 1} body area`, { max: 80 }),
    severity: check.integer(data["severity"], `Symptom ${i + 1} severity`, 0, 10),
  };
}

function normalizeCheckIn(data: Record<string, unknown>, now: LocalDateTime) {
  const body = {
    at: check.dateTime(data["at"], "When") ?? now,
    overall: check.integer(data["overall"], "Overall", 1, 5),
    energy: check.integer(data["energy"], "Energy", 1, 5),
    symptoms: check.list(data["symptoms"], "Symptoms", 20).map(normalizeSymptom),
    bpSys: check.integer(data["bpSys"], "Systolic blood pressure", 50, 300),
    bpDia: check.integer(data["bpDia"], "Diastolic blood pressure", 20, 200),
    heartRate: check.integer(data["heartRate"], "Heart rate", 20, 250),
    temperatureF: check.decimalText(data["temperatureF"], "Temperature"),
    weightLb: check.decimalText(data["weightLb"], "Weight"),
    glucose: check.decimalText(data["glucose"], "Blood sugar"),
    note: check.text(data["note"], "Note"),
  };
  if ((body.bpSys === null) !== (body.bpDia === null)) throw invalid("Blood pressure needs both numbers, such as 128 over 82.");
  const empty =
    body.overall === null && body.energy === null && body.symptoms.length === 0 && body.bpSys === null && body.heartRate === null &&
    body.temperatureF === null && body.weightLb === null && body.glucose === null && body.note === "";
  if (empty) throw invalid("A check-in needs at least one thing: a rating, a symptom, a reading, or a note.");
  return body;
}

function normalizeQuestion(state: HealthState, data: Record<string, unknown>, existing: Question | null) {
  return {
    text: check.text(data["text"], "Question", { required: true, max: 500 }),
    appointmentId: ref(state, data["appointmentId"], "Appointment", "appointment"),
    relatedIds: refs(state, data["relatedIds"], "Related records", RELATED),
    status: data["status"] === undefined || data["status"] === null || data["status"] === ""
      ? existing?.status ?? "OPEN"
      : check.oneOf(data["status"], "Status", QUESTION_STATUSES),
    answer: check.text(data["answer"], "Answer"),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Apply.

/** A change's time: a date and time, a date (taken as midnight), or now. */
function whenOf(value: unknown, now: LocalDateTime): LocalDateTime {
  if (value === undefined || value === null || value === "") return now;
  if (typeof value === "string" && value.length === 10) return `${check.date(value, "When") as string}T00:00`;
  return check.dateTime(value, "When") ?? now;
}

function created(at: LocalDateTime, status: string, note: string): StatusChange {
  return { at, from: null, to: status, note };
}

function upsert<T extends { readonly id: string }>(records: readonly T[], record: T): T[] {
  const i = records.findIndex((r) => r.id === record.id);
  return i < 0 ? [...records, record] : records.map((r, j) => (j === i ? record : r));
}

function existingOf<T extends { readonly id: string }>(records: readonly T[], id: string | null | undefined, label: string): T | null {
  if (id === undefined || id === null || id === "") return null;
  const record = records.find((r) => r.id === id);
  if (record === undefined) throw notFound(`${label} ${id} is not in the record.`);
  return record;
}

function save(draft: Draft, collection: Collection, id: string | null | undefined, input: unknown, now: LocalDateTime, meta: Meta): string | null {
  const data = obj(input, "Data");
  const state = draft as HealthState;
  switch (collection) {
    case "provider": {
      const existing = existingOf(state.providers, id, "Doctor");
      const record: Provider = { id: existing?.id ?? takeId(draft, PREFIX.provider), ...normalizeProvider(data) };
      draft.providers = upsert(state.providers, record);
      return existing === null ? record.id : null;
    }
    case "appointment": {
      const existing = existingOf(state.appointments, id, "Appointment");
      const body = normalizeAppointment(state, data, existing);
      const history = [...(existing?.history ?? [created(now, body.status, meta.source === "AI" ? "Added from an AI suggestion" : "Added")])];
      if (existing !== null && existing.start !== body.start && existing.start !== null && body.start !== null) {
        history.push({ at: now, from: existing.status, to: body.status, note: `Rescheduled from ${existing.start.replace("T", " ")} to ${body.start.replace("T", " ")}` });
      } else if (existing !== null && existing.status !== body.status) {
        history.push({ at: now, from: existing.status, to: body.status, note: "" });
      }
      const record: Appointment = {
        id: existing?.id ?? takeId(draft, PREFIX.appointment),
        ...body,
        source: existing?.source ?? meta.source,
        aiRunId: existing?.aiRunId ?? meta.aiRunId,
        history,
      };
      draft.appointments = upsert(state.appointments, record);
      return existing === null ? record.id : null;
    }
    case "medication": {
      const existing = existingOf(state.medications, id, "Medication");
      const body = normalizeMedication(state, data, existing);
      const changedOn = check.date(data["changedOn"], "Change date");
      const at = changedOn === null ? now : `${changedOn}T00:00`;
      const history = [...(existing?.history ?? [created(body.startDate === null ? now : `${body.startDate}T00:00`, body.status, "Started")])];
      if (existing !== null) {
        const changes: string[] = [];
        if (existing.dose !== body.dose) changes.push(`dose ${existing.dose || "(none)"} → ${body.dose || "(none)"}`);
        if (existing.instructions !== body.instructions) changes.push(`instructions "${existing.instructions}" → "${body.instructions}"`);
        if (existing.status !== body.status || changes.length > 0) {
          history.push({ at, from: existing.status, to: body.status, note: changes.length === 0 ? "" : `Changed ${changes.join("; ")}` });
        }
      }
      const record: Medication = { id: existing?.id ?? takeId(draft, PREFIX.medication), ...body, history };
      draft.medications = upsert(state.medications, record);
      return existing === null ? record.id : null;
    }
    case "diagnosis": {
      const existing = existingOf(state.diagnoses, id, "Diagnosis");
      const body = normalizeDiagnosis(state, data, existing);
      const history = [...(existing?.history ?? [created(body.diagnosedOn === null ? now : `${body.diagnosedOn}T00:00`, body.status, "Diagnosed")])];
      if (existing !== null && existing.status !== body.status) history.push({ at: now, from: existing.status, to: body.status, note: "" });
      const record: Diagnosis = { id: existing?.id ?? takeId(draft, PREFIX.diagnosis), ...body, history };
      draft.diagnoses = upsert(state.diagnoses, record);
      return existing === null ? record.id : null;
    }
    case "test": {
      const existing = existingOf(state.tests, id, "Test");
      const body = normalizeTest(state, data, existing);
      const history = [...(existing?.history ?? [created(now, body.status, "Tracking started")])];
      if (existing !== null && existing.status !== body.status) history.push({ at: now, from: existing.status, to: body.status, note: "" });
      const record: Test = { id: existing?.id ?? takeId(draft, PREFIX.test), ...body, history };
      draft.tests = upsert(state.tests, record);
      return existing === null ? record.id : null;
    }
    case "result": {
      const existing = existingOf(state.results, id, "Result");
      const body = normalizeResult(state, data);
      const record: Result = {
        id: existing?.id ?? takeId(draft, PREFIX.result),
        ...body,
        source: existing?.source ?? meta.source,
        aiRunId: existing?.aiRunId ?? meta.aiRunId,
      };
      draft.results = upsert(state.results, record);
      return existing === null ? record.id : null;
    }
    case "checkIn": {
      const existing = existingOf(state.checkIns, id, "Check-in");
      const body = normalizeCheckIn(data, now);
      const by = existing?.by ?? meta.by ?? null;
      const record: CheckIn = {
        id: existing?.id ?? takeId(draft, PREFIX.checkIn),
        ...body,
        source: existing?.source ?? meta.source,
        aiRunId: existing?.aiRunId ?? meta.aiRunId,
        ...(by === null ? {} : { by }),
      };
      draft.checkIns = upsert(state.checkIns, record);
      return existing === null ? record.id : null;
    }
    case "meal": {
      const existing = existingOf(state.meals, id, "Meal");
      const body = normalizeMeal(data, now);
      const by = existing?.by ?? meta.by ?? null;
      const record: Meal = {
        id: existing?.id ?? takeId(draft, PREFIX.meal),
        ...body,
        source: existing?.source ?? meta.source,
        aiRunId: existing?.aiRunId ?? meta.aiRunId,
        ...(by === null ? {} : { by }),
      };
      draft.meals = upsert(state.meals, record);
      return existing === null ? record.id : null;
    }
    case "question": {
      const existing = existingOf(state.questions, id, "Question");
      const body = normalizeQuestion(state, data, existing);
      const by = existing?.by ?? meta.by ?? null;
      const record: Question = {
        id: existing?.id ?? takeId(draft, PREFIX.question),
        ...body,
        createdAt: existing?.createdAt ?? now,
        source: existing?.source ?? meta.source,
        aiRunId: existing?.aiRunId ?? meta.aiRunId,
        ...(by === null ? {} : { by }),
      };
      draft.questions = upsert(state.questions, record);
      return existing === null ? record.id : null;
    }
  }
}

function setStatus(draft: Draft, command: Extract<Command, { type: "status" }>, now: LocalDateTime): void {
  const state = draft as HealthState;
  const at = whenOf(command.at, now);
  const note = check.text(command.note, "Note", { max: 1000 });
  switch (command.collection) {
    case "appointment": {
      const record = existingOf(state.appointments, command.id, "Appointment");
      if (record === null) throw invalid("Appointment is required.");
      const status = check.oneOf(command.status, "Status", APPOINTMENT_STATUSES);
      if ((status === "SCHEDULED" || status === "COMPLETED") && record.start === null) {
        throw invalid("Set the date and time first, by editing the appointment.");
      }
      const outcome = command.outcome === undefined ? record.outcome : check.text(command.outcome, "Visit notes");
      draft.appointments = upsert(state.appointments, {
        ...record,
        status,
        outcome,
        history: [...record.history, { at, from: record.status, to: status, note }],
      });
      return;
    }
    case "medication": {
      const record = existingOf(state.medications, command.id, "Medication");
      if (record === null) throw invalid("Medication is required.");
      const status = check.oneOf(command.status, "Status", MEDICATION_STATUSES);
      draft.medications = upsert(state.medications, { ...record, status, history: [...record.history, { at, from: record.status, to: status, note }] });
      return;
    }
    case "diagnosis": {
      const record = existingOf(state.diagnoses, command.id, "Diagnosis");
      if (record === null) throw invalid("Diagnosis is required.");
      const status = check.oneOf(command.status, "Status", DIAGNOSIS_STATUSES);
      draft.diagnoses = upsert(state.diagnoses, { ...record, status, history: [...record.history, { at, from: record.status, to: status, note }] });
      return;
    }
    case "test": {
      const record = existingOf(state.tests, command.id, "Test");
      if (record === null) throw invalid("Test is required.");
      const status = check.oneOf(command.status, "Status", TRACK_STATUSES);
      draft.tests = upsert(state.tests, { ...record, status, history: [...record.history, { at, from: record.status, to: status, note }] });
      return;
    }
    case "question": {
      const record = existingOf(state.questions, command.id, "Question");
      if (record === null) throw invalid("Question is required.");
      const status = check.oneOf(command.status, "Status", QUESTION_STATUSES);
      const answer = command.answer === undefined ? record.answer : check.text(command.answer, "Answer");
      draft.questions = upsert(state.questions, { ...record, status, answer });
      return;
    }
  }
}

/** Removes every reference to an ID, so no record points at something deleted. */
function stripReferences(draft: Draft, id: string): void {
  const state = draft as HealthState;
  const without = (ids: readonly string[]) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids);
  draft.appointments = state.appointments.map((a) => ({ ...a, providerId: a.providerId === id ? null : a.providerId, relatedIds: without(a.relatedIds) }));
  draft.medications = state.medications.map((m) => ({ ...m, prescriberId: m.prescriberId === id ? null : m.prescriberId, diagnosisIds: without(m.diagnosisIds) }));
  draft.diagnoses = state.diagnoses.map((d) => ({ ...d, providerId: d.providerId === id ? null : d.providerId }));
  if (state.profile.primaryProviderId === id) draft.profile = { ...state.profile, primaryProviderId: null };
  draft.tests = state.tests.map((t) => ({ ...t, diagnosisIds: without(t.diagnosisIds) }));
  draft.questions = state.questions.map((q) => ({ ...q, appointmentId: q.appointmentId === id ? null : q.appointmentId, relatedIds: without(q.relatedIds) }));
}

function remove(draft: Draft, collection: DeleteCollection, id: string): void {
  const state = draft as HealthState;
  if (collection === "thread") {
    if (!state.threads.some((t) => t.id === id)) throw notFound(`Chat ${id} is not in the record.`);
    draft.threads = state.threads.filter((t) => t.id !== id);
    return;
  }
  if (collection === "importDoc") {
    if (!state.imports.some((d) => d.id === id)) throw notFound(`Document ${id} is not in the record.`);
    draft.imports = state.imports.filter((d) => d.id !== id);
    return;
  }
  const key = ARRAY_OF[collection];
  const records = state[key] as readonly { readonly id: string }[];
  if (!records.some((r) => r.id === id)) throw notFound(`${id} is not in the record.`);
  (draft as Record<string, unknown>)[key] = records.filter((r) => r.id !== id);
  if (collection === "test") {
    const removed = state.results.filter((r) => r.testId === id).map((r) => r.id);
    draft.results = state.results.filter((r) => r.testId !== id);
    for (const resultId of removed) stripReferences(draft, resultId);
  }
  stripReferences(draft, id);
}

export function applyCommand(state: HealthState, command: Command, now: LocalDateTime, meta: Meta = PERSON): Applied {
  if (typeof command !== "object" || command === null) throw invalid("The command is empty.");
  const draft: Draft = { ...state };
  const createdIds: string[] = [];
  switch (command.type) {
    case "profile.save":
      draft.profile = normalizeProfile(command.profile, state.profile.sample, state);
      break;
    case "people.save":
      draft.people = normalizePeople(command.people);
      break;
    case "diet.save":
      draft.diet = normalizeDiet(command.diet);
      break;
    case "save": {
      const collection = check.oneOf(command.collection, "Collection", COLLECTIONS);
      const id = save(draft, collection, command.id, command.data, now, meta);
      if (id !== null) createdIds.push(id);
      break;
    }
    case "status":
      check.oneOf(command.collection, "Collection", STATUS_COLLECTIONS);
      setStatus(draft, command, now);
      break;
    case "delete":
      remove(draft, check.oneOf(command.collection, "Collection", DELETE_COLLECTIONS), check.text(command.id, "ID", { required: true, max: 40 }));
      break;
    default:
      throw invalid(`Unknown command ${(command as { type?: unknown }).type as string}.`);
  }
  draft.revision = state.revision + 1;
  draft.updatedAt = now;
  return { state: draft, createdIds };
}

/** Applies several commands as one change: all of them, or none. */
export function applyAll(state: HealthState, commands: readonly Command[], now: LocalDateTime, meta: Meta = PERSON): Applied {
  let current = state;
  const createdIds: string[] = [];
  for (const command of commands) {
    const applied = applyCommand(current, command, now, meta);
    current = applied.state;
    createdIds.push(...applied.createdIds);
  }
  return { state: { ...current, revision: state.revision + 1 }, createdIds };
}

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;
export { PREFIX_OF };

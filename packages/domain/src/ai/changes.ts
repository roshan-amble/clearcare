import { applyAll, findRecord, PREFIX_OF, type Collection, type Command, type StatusCollection } from "../commands.js";
import { addDays } from "../dates.js";
import { DomainError, invalid } from "../errors.js";
import {
  APPOINTMENT_STATUSES,
  BLOOD_TYPES,
  DIAGNOSIS_STATUSES,
  FREQUENCY_UNITS,
  MEAL_KINDS,
  MEDICATION_STATUSES,
  QUESTION_STATUSES,
  TEST_KINDS,
  TRACK_STATUSES,
  type HealthState,
  type LocalDate,
  type LocalDateTime,
  type Test,
} from "../types.js";

/**
 * Record changes Claude can propose from a chat: create or update any record (SAVE), change a status (STATUS), or
 * delete (DELETE). One field registry drives the output schema, the conversion into ordinary commands, and the page
 * that shows the change. A change is checked by running it on a copy of the record, with the same rules as a
 * person's own edit, and is applied only when a person accepts it.
 */

export const CHANGE_COLLECTIONS = ["appointment", "medication", "diagnosis", "test", "result", "checkIn", "question", "meal", "diet", "provider", "profile"] as const;
export type ChangeCollection = (typeof CHANGE_COLLECTIONS)[number];

/** partialdate: a day (YYYY-MM-DD), a month (YYYY-MM) or a year (YYYY). */
export type FieldType = "text" | "longtext" | "date" | "partialdate" | "datetime" | "int" | "decimal" | "bool" | "enum" | "ref" | "ids" | "list" | "symptoms";

export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly options?: readonly string[];
  /** For ref and ids: which kind of record the ID names. Uploaded documents ("file") are never created by a change. */
  readonly refs?: Collection | "file";
}

const f = (key: string, label: string, type: FieldType, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, type, ...extra });

export const CHANGE_FIELDS: Readonly<Record<ChangeCollection, readonly FieldSpec[]>> = {
  appointment: [
    f("title", "Reason", "text"),
    f("providerId", "Doctor", "ref", { refs: "provider" }),
    f("specialty", "Specialty", "text"),
    f("start", "Date and time", "datetime"),
    f("bookBy", "Book by", "date"),
    f("location", "Location", "text"),
    f("prep", "Preparation", "longtext"),
    f("outcome", "Visit notes", "longtext"),
    f("status", "Status", "enum", { options: APPOINTMENT_STATUSES }),
    f("relatedIds", "Related", "ids"),
    f("fileIds", "Documents", "ids", { refs: "file" }),
  ],
  medication: [
    f("name", "Medication", "text"),
    f("dose", "Dose", "text"),
    f("instructions", "How to take it", "text"),
    f("timesPerDay", "Times a day", "int"),
    f("asNeeded", "Only as needed", "bool"),
    f("purpose", "What it is for", "text"),
    f("diagnosisIds", "For", "ids", { refs: "diagnosis" }),
    f("prescriberId", "Prescribed by", "ref", { refs: "provider" }),
    f("startDate", "Started", "date"),
    f("refillDue", "Refill due", "date"),
    f("status", "Status", "enum", { options: MEDICATION_STATUSES }),
    f("changedOn", "Change took effect", "date"),
    f("notes", "Notes", "longtext"),
  ],
  diagnosis: [
    f("name", "Diagnosis", "text"),
    f("diagnosedOn", "Diagnosed", "date"),
    f("providerId", "Doctor", "ref", { refs: "provider" }),
    f("status", "Status", "enum", { options: DIAGNOSIS_STATUSES }),
    f("notes", "Notes", "longtext"),
  ],
  test: [
    f("name", "Test", "text"),
    f("kind", "Kind", "enum", { options: TEST_KINDS }),
    f("unit", "Unit", "text"),
    f("refLow", "Normal range low", "decimal"),
    f("refHigh", "Normal range high", "decimal"),
    f("frequencyEvery", "Repeat every", "int"),
    f("frequencyUnit", "Repeat unit", "enum", { options: FREQUENCY_UNITS }),
    f("diagnosisIds", "For", "ids", { refs: "diagnosis" }),
    f("status", "Status", "enum", { options: TRACK_STATUSES }),
    f("notes", "Notes", "longtext"),
  ],
  result: [
    f("testId", "Test", "ref", { refs: "test" }),
    f("testName", "New test", "text"),
    f("testKind", "Kind of test", "enum", { options: TEST_KINDS }),
    f("unit", "Unit", "text"),
    f("refLow", "Normal range low", "decimal"),
    f("refHigh", "Normal range high", "decimal"),
    f("date", "Date", "partialdate"),
    f("value", "Value", "text"),
    f("impression", "Impression", "longtext"),
    f("findings", "Findings", "longtext"),
    f("facility", "Where", "text"),
    f("providerId", "Doctor", "ref", { refs: "provider" }),
    f("fileIds", "Documents", "ids", { refs: "file" }),
    f("note", "Note", "longtext"),
  ],
  checkIn: [
    f("at", "When", "datetime"),
    f("overall", "Feeling (1 to 5)", "int"),
    f("energy", "Energy (1 to 5)", "int"),
    f("symptoms", "Symptoms", "symptoms"),
    f("bpSys", "Blood pressure, top", "int"),
    f("bpDia", "Blood pressure, bottom", "int"),
    f("heartRate", "Heart rate", "int"),
    f("temperatureF", "Temperature °F", "decimal"),
    f("weightLb", "Weight lb", "decimal"),
    f("glucose", "Blood sugar", "decimal"),
    f("note", "Note", "longtext"),
  ],
  question: [
    f("text", "Question", "longtext"),
    f("appointmentId", "Ask at", "ref", { refs: "appointment" }),
    f("status", "Status", "enum", { options: QUESTION_STATUSES }),
    f("answer", "Answer", "longtext"),
    f("relatedIds", "Related", "ids"),
  ],
  meal: [f("at", "When", "datetime"), f("kind", "Meal", "enum", { options: MEAL_KINDS }), f("description", "What she ate", "longtext"), f("note", "Note", "text")],
  diet: [f("goalWeightLb", "Goal weight (lb)", "decimal"), f("goalDate", "Goal date", "date"), f("plan", "Plan", "longtext")],
  provider: [f("name", "Name", "text"), f("specialty", "Specialty", "text"), f("phone", "Phone", "text"), f("address", "Address", "text"), f("notes", "Notes", "longtext")],
  profile: [
    f("birthDate", "Birth date", "date"),
    f("sex", "Sex", "enum", { options: ["FEMALE", "MALE", "OTHER"] }),
    f("heightIn", "Height (inches)", "decimal"),
    f("bloodType", "Blood type", "enum", { options: BLOOD_TYPES }),
    f("allergies", "Allergies", "list"),
    f("primaryProviderId", "Primary doctor", "ref", { refs: "provider" }),
    f("pharmacy", "Pharmacy", "text"),
    f("preferredHospital", "Preferred hospital", "text"),
    f("mobility", "Mobility and aids", "text"),
    f("livingSituation", "Living situation", "text"),
    f("lifestyle", "Lifestyle", "longtext"),
    f("advanceDirective", "Advance directive", "text"),
    f("healthcareProxy", "Healthcare proxy", "text"),
    f("emergencyContact", "Emergency contact", "text"),
    f("insurance", "Insurance", "text"),
    f("notes", "Notes", "longtext"),
  ],
};

export type ChangeFields = Readonly<Record<string, unknown>>;

export type ChangeProposal =
  | {
      readonly kind: "SAVE";
      readonly collection: ChangeCollection;
      /** Null creates a record; an ID updates that record, keeping every field left null. */
      readonly id: string | null;
      readonly summary: string;
      readonly fields: ChangeFields;
    }
  | {
      readonly kind: "STATUS";
      readonly collection: StatusCollection;
      readonly id: string;
      readonly status: string;
      readonly at: LocalDate | null;
      readonly note: string;
      readonly outcome: string | null;
      readonly answer: string | null;
      readonly summary: string;
    }
  | { readonly kind: "DELETE"; readonly collection: Collection; readonly id: string; readonly summary: string };

// ---------------------------------------------------------------------------------------------------------------
// The output schema, from the registry. Every field is required and nullable, the shape structured output wants.

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

function fieldSchema(spec: FieldSpec): object {
  switch (spec.type) {
    case "int":
      return nullable({ type: "integer" });
    case "bool":
      return nullable({ type: "boolean" });
    case "enum":
      return nullable({ type: "string", enum: [...(spec.options ?? [])] });
    case "ids":
    case "list":
      return nullable({ type: "array", items: { type: "string" } });
    case "symptoms":
      return nullable({
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "bodyArea", "severity"],
          properties: { name: { type: "string" }, bodyArea: { type: "string" }, severity: nullable({ type: "integer" }) },
        },
      });
    default:
      return nullable({ type: "string" });
  }
}

export function changeSchemas(): object[] {
  const saves = CHANGE_COLLECTIONS.map((collection) => ({
    type: "object",
    additionalProperties: false,
    required: ["kind", "collection", "id", "summary", "fields"],
    properties: {
      kind: { type: "string", const: "SAVE" },
      collection: { type: "string", const: collection },
      id: nullable({ type: "string" }),
      summary: { type: "string" },
      fields: {
        type: "object",
        additionalProperties: false,
        required: CHANGE_FIELDS[collection].map((s) => s.key),
        properties: Object.fromEntries(CHANGE_FIELDS[collection].map((s) => [s.key, fieldSchema(s)])),
      },
    },
  }));
  return [
    ...saves,
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "collection", "id", "status", "at", "note", "outcome", "answer", "summary"],
      properties: {
        kind: { type: "string", const: "STATUS" },
        collection: { type: "string", enum: ["appointment", "medication", "diagnosis", "test", "question"] },
        id: { type: "string" },
        status: { type: "string" },
        at: nullable({ type: "string" }),
        note: { type: "string" },
        outcome: nullable({ type: "string" }),
        answer: nullable({ type: "string" }),
        summary: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "collection", "id", "summary"],
      properties: {
        kind: { type: "string", const: "DELETE" },
        collection: { type: "string", enum: ["appointment", "medication", "diagnosis", "test", "result", "checkIn", "question", "meal", "provider"] },
        id: { type: "string" },
        summary: { type: "string" },
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// From a change to commands.

/** The fields that carry a value: null and undefined mean "not given". */
export function givenFields(fields: ChangeFields, edits: ChangeFields = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...fields, ...edits })) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

const ARRAYS: Record<Exclude<ChangeCollection, "profile" | "diet">, keyof HealthState> = {
  appointment: "appointments",
  medication: "medications",
  diagnosis: "diagnoses",
  test: "tests",
  result: "results",
  checkIn: "checkIns",
  question: "questions",
  meal: "meals",
  provider: "providers",
};

function existing(state: HealthState, collection: Exclude<ChangeCollection, "profile" | "diet">, id: string): Record<string, unknown> {
  const record = (state[ARRAYS[collection]] as readonly { readonly id: string }[]).find((r) => r.id === id);
  if (record === undefined) {
    const other = findRecord(state, id);
    throw invalid(other === null ? `${id} is not in the record.` : `${id} is a ${other.collection}, not a ${collection}.`);
  }
  return record as unknown as Record<string, unknown>;
}

function frequencyOf(given: Record<string, unknown>, before: Test["frequency"]): Test["frequency"] | { every: unknown; unit: unknown } {
  if (given["frequencyEvery"] === undefined && given["frequencyUnit"] === undefined) return before;
  return { every: given["frequencyEvery"] ?? before?.every ?? null, unit: given["frequencyUnit"] ?? before?.unit ?? "MONTH" };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function changeToCommands(state: HealthState, change: ChangeProposal, edits: ChangeFields = {}): Command[] {
  switch (change.kind) {
    case "DELETE":
      return [{ type: "delete", collection: change.collection, id: change.id }];
    case "STATUS": {
      const given = givenFields({}, edits);
      return [
        {
          type: "status",
          collection: change.collection,
          id: change.id,
          status: (given["status"] as string | undefined) ?? change.status,
          note: (given["note"] as string | undefined) ?? change.note,
          at: (given["at"] as string | undefined) ?? change.at,
          ...(change.outcome === null && given["outcome"] === undefined ? {} : { outcome: (given["outcome"] as string | undefined) ?? change.outcome ?? "" }),
          ...(change.answer === null && given["answer"] === undefined ? {} : { answer: (given["answer"] as string | undefined) ?? change.answer ?? "" }),
        },
      ];
    }
    case "SAVE": {
      const given = givenFields(change.fields, edits);
      // "Related" links may name computed facts; keep only real records.
      if (Array.isArray(given["relatedIds"])) given["relatedIds"] = (given["relatedIds"] as unknown[]).filter((id) => typeof id === "string" && findRecord(state, id) !== null);
      const collection = change.collection;
      if (collection === "profile") {
        if (change.id !== null) throw invalid("The profile has no ID.");
        return [{ type: "profile.save", profile: { ...state.profile, ...given } }];
      }
      if (collection === "diet") return [{ type: "diet.save", diet: { ...state.diet, ...given } }];
      if (change.id !== null) {
        const before = existing(state, collection, change.id);
        const data: Record<string, unknown> = { ...before, ...given };
        if (collection === "test") data["frequency"] = frequencyOf(given, (before as unknown as Test).frequency);
        if (collection === "appointment" && given["start"] !== undefined && given["status"] === undefined && before["status"] === "TO_BOOK") data["status"] = "SCHEDULED";
        if (collection === "medication" && given["changedOn"] === undefined) delete data["changedOn"];
        return [{ type: "save", collection, id: change.id, data }];
      }
      const data: Record<string, unknown> = { ...given };
      // A check-in or meal with a date but no time is kept at midday rather than refused.
      if ((collection === "checkIn" || collection === "meal") && typeof data["at"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data["at"])) data["at"] = `${data["at"]}T12:00`;
      if (collection === "test") data["frequency"] = frequencyOf(given, null);
      if (collection === "appointment" && data["start"] !== undefined && data["status"] === "TO_BOOK") data["status"] = "SCHEDULED";
      if (collection === "result" && data["testId"] === undefined) {
        const name = typeof data["testName"] === "string" ? data["testName"] : "";
        if (name.trim() === "") throw invalid("A result needs its test: an existing test ID or the name of a new test.");
        const known = state.tests.find((t) => sameName(t.name, name));
        if (known !== undefined) return [{ type: "save", collection: "result", data: { ...data, testId: known.id } }];
        // The new test takes the next TST number, which applyAll assigns in order.
        const testId = `TST-${(state.counters["TST"] ?? 0) + 1}`;
        return [
          { type: "save", collection: "test", data: { name, kind: data["testKind"] ?? "LAB", unit: data["unit"] ?? "", refLow: data["refLow"] ?? null, refHigh: data["refHigh"] ?? null } },
          { type: "save", collection: "result", data: { ...data, testId } },
        ];
      }
      return [{ type: "save", collection, data }];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// References between the changes of one answer: "#2" is the record that the answer's second change creates.

const PLACEHOLDER = /^#(\d+)$/;

/** Picks, among the IDs a change created, the one of the kind a field expects. */
export function pickCreated(ids: readonly string[], refs: Collection | undefined): string | null {
  if (ids.length === 0) return null;
  if (refs !== undefined) return ids.find((id) => id.startsWith(`${PREFIX_OF[refs]}-`)) ?? null;
  return ids.at(-1) ?? null;
}

/** Replaces each "#N" with a real ID. resolve throws a DomainError when it cannot. */
export function resolveChange(change: ChangeProposal, resolve: (n: number, refs: Collection | undefined) => string): ChangeProposal {
  const one = (value: unknown, refs: Collection | undefined): unknown => {
    if (typeof value !== "string") return value;
    const match = PLACEHOLDER.exec(value.trim());
    return match === null ? value : resolve(Number(match[1]), refs);
  };
  if (change.kind !== "SAVE") return { ...change, id: one(change.id, change.collection) as string };
  const fields: Record<string, unknown> = { ...change.fields };
  for (const spec of CHANGE_FIELDS[change.collection]) {
    const value = fields[spec.key];
    if (spec.refs === "file") continue;
    if (spec.type === "ref") fields[spec.key] = one(value, spec.refs as Collection | undefined);
    if (spec.type === "ids" && Array.isArray(value)) fields[spec.key] = value.map((v) => one(v, spec.refs as Collection | undefined));
  }
  const id = change.id === null || change.collection === "profile" || change.collection === "diet" ? change.id : (one(change.id, change.collection) as string);
  return { ...change, id, fields };
}

export interface ChangeCheck {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * Runs an answer's changes in order on a copy of the record, as Apply all would. A change that points at a later
 * change, or at one that cannot be applied, is refused. The record itself is untouched.
 */
export function checkChanges(state: HealthState, changes: readonly ChangeProposal[], now: LocalDateTime): ChangeCheck[] {
  let copy = state;
  const created: (readonly string[] | null)[] = [];
  return changes.map((change, i) => {
    try {
      const resolved = resolveChange(change, (n, refs) => {
        if (n - 1 >= i) throw invalid(`It points at suggestion ${n}, which comes after it.`);
        const id = created[n - 1] === null || created[n - 1] === undefined ? null : pickCreated(created[n - 1]!, refs);
        if (id === null) throw invalid(`It points at suggestion ${n}, which can't be applied.`);
        return id;
      });
      const applied = applyAll(copy, changeToCommands(copy, resolved), now);
      copy = applied.state;
      created[i] = applied.createdIds;
      return { ok: true, reasons: [] };
    } catch (error) {
      created[i] = null;
      if (error instanceof DomainError) return { ok: false, reasons: [error.message] };
      throw error;
    }
  });
}

/** Runs one change on a copy of the record. */
export function checkChange(state: HealthState, change: ChangeProposal, now: LocalDateTime): ChangeCheck {
  return checkChanges(state, [change], now)[0]!;
}

/** Proposals stored before record changes existed, read as changes. */
export function legacyToChange(proposal: Record<string, unknown>, today: LocalDate): ChangeProposal | null {
  const blank = (collection: ChangeCollection) => Object.fromEntries(CHANGE_FIELDS[collection].map((s) => [s.key, null]));
  switch (proposal["kind"]) {
    case "APPOINTMENT":
      return {
        kind: "SAVE",
        collection: "appointment",
        id: null,
        summary: `Book: ${String(proposal["title"])}`,
        fields: {
          ...blank("appointment"),
          title: proposal["title"],
          specialty: proposal["specialty"],
          providerId: proposal["providerId"],
          bookBy: addDays(today, Number(proposal["bookWithinDays"] ?? 0)),
          prep: proposal["reason"],
          status: "TO_BOOK",
          relatedIds: proposal["relatedIds"],
        },
      };
    case "CHECKIN":
      return {
        kind: "SAVE",
        collection: "checkIn",
        id: null,
        summary: "Log this as a check-in",
        fields: { ...blank("checkIn"), overall: proposal["overall"], energy: proposal["energy"], symptoms: proposal["symptoms"], note: proposal["note"] },
      };
    case "QUESTION":
      return {
        kind: "SAVE",
        collection: "question",
        id: null,
        summary: "Add a question for the doctor",
        fields: { ...blank("question"), text: proposal["text"], appointmentId: proposal["appointmentId"], relatedIds: proposal["relatedIds"] },
      };
    default:
      return null;
  }
}

/**
 * The health record of one person. Every clinical time is local wall-clock time, as a family member reads it on a
 * paper summary: dates are YYYY-MM-DD and times are YYYY-MM-DDTHH:mm, with no time zone.
 */
export type LocalDate = string;
export type LocalDateTime = string;

/** Who created a record: a person typing it, or a person accepting an AI proposal. */
export type Source = "PERSON" | "AI";

/** One change of status, kept forever, oldest first. */
export interface StatusChange {
  readonly at: LocalDateTime;
  readonly from: string | null;
  readonly to: string;
  readonly note: string;
}

export type Sex = "FEMALE" | "MALE" | "OTHER";

export const ROLES = ["CAREGIVER", "PATIENT"] as const;
/** A caregiver is family looking after her; the patient is the person whose record this is. */
export type Role = (typeof ROLES)[number];

/** Someone allowed in through Tailscale, by their Tailscale login. */
export interface Person {
  readonly login: string;
  readonly name: string;
  readonly role: Role;
}

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/** Who she is: the facts a new doctor or an ambulance crew would ask for. Weight is logged over time in check-ins. */
export interface Profile {
  readonly name: string;
  /** Kept for records written before birthDate; birthDate wins when both are set. */
  readonly birthYear: number | null;
  readonly birthDate?: LocalDate | null;
  readonly sex: Sex | null;
  /** Total inches, exact decimal text, such as "62.5". */
  readonly heightIn?: string | null;
  readonly bloodType?: BloodType | null;
  readonly allergies: readonly string[];
  readonly primaryProviderId?: string | null;
  readonly pharmacy?: string;
  readonly preferredHospital?: string;
  /** Walker, cane, hearing aids, glasses, help with stairs. */
  readonly mobility?: string;
  readonly livingSituation?: string;
  /** Activity, smoking, alcohol, sleep. */
  readonly lifestyle?: string;
  readonly advanceDirective?: string;
  readonly healthcareProxy?: string;
  readonly emergencyContact: string;
  readonly insurance?: string;
  readonly notes: string;
  /** True while the record holds the generated sample patient. */
  readonly sample: boolean;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly specialty: string;
  readonly phone: string;
  readonly address: string;
  readonly notes: string;
}

export const APPOINTMENT_STATUSES = ["TO_BOOK", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  readonly id: string;
  readonly title: string;
  readonly providerId: string | null;
  readonly specialty: string;
  /** Null while the appointment still has to be booked. */
  readonly start: LocalDateTime | null;
  /** The date to book it by, for TO_BOOK appointments. */
  readonly bookBy: LocalDate | null;
  readonly location: string;
  readonly status: AppointmentStatus;
  readonly prep: string;
  readonly outcome: string;
  readonly relatedIds: readonly string[];
  /** Uploaded documents about this visit, such as its visit summary. */
  readonly fileIds?: readonly string[];
  readonly source: Source;
  readonly aiRunId: string | null;
  readonly history: readonly StatusChange[];
}

export const MEDICATION_STATUSES = ["ACTIVE", "PAUSED", "STOPPED"] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export interface Medication {
  readonly id: string;
  readonly name: string;
  readonly dose: string;
  readonly instructions: string;
  readonly timesPerDay: number | null;
  readonly asNeeded: boolean;
  readonly purpose: string;
  readonly diagnosisIds: readonly string[];
  readonly prescriberId: string | null;
  readonly startDate: LocalDate | null;
  readonly refillDue: LocalDate | null;
  readonly status: MedicationStatus;
  readonly notes: string;
  readonly history: readonly StatusChange[];
}

export const DIAGNOSIS_STATUSES = ["ACTIVE", "MONITORING", "MANAGED", "RESOLVED"] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

export interface Diagnosis {
  readonly id: string;
  readonly name: string;
  readonly diagnosedOn: LocalDate | null;
  readonly status: DiagnosisStatus;
  readonly providerId: string | null;
  readonly notes: string;
  readonly history: readonly StatusChange[];
}

export const FREQUENCY_UNITS = ["DAY", "WEEK", "MONTH", "YEAR"] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

export interface Frequency {
  readonly every: number;
  readonly unit: FrequencyUnit;
}

export const TEST_KINDS = ["LAB", "VITAL", "IMAGING", "PATHOLOGY", "PROCEDURE", "SCREENING", "OTHER"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

/** How exact a date is. A month or year is stored as its first day. */
export const DATE_PRECISIONS = ["DAY", "MONTH", "YEAR"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const TRACK_STATUSES = ["ACTIVE", "PAUSED", "STOPPED"] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

/** Something measured again and again: a lab, a vital sign, a scan, a screening. */
export interface Test {
  readonly id: string;
  readonly name: string;
  readonly kind: TestKind;
  readonly unit: string;
  /** Reference range as the lab prints it, exact decimal text. */
  readonly refLow: string | null;
  readonly refHigh: string | null;
  readonly frequency: Frequency | null;
  readonly diagnosisIds: readonly string[];
  readonly status: TrackStatus;
  readonly notes: string;
  readonly history: readonly StatusChange[];
}

/**
 * One result of a test. A lab or vital sign has a value; a scan, biopsy or procedure has a written report: the
 * impression (the conclusion), the findings, and the documents it came in. A report may also carry a short value,
 * such as "BI-RADS 1".
 */
export interface Result {
  readonly id: string;
  readonly testId: string;
  readonly date: LocalDate;
  /** DAY when absent. For "March 2026" the date is 2026-03-01 and the precision MONTH. */
  readonly datePrecision?: DatePrecision;
  /** The value exactly as reported: "7.4", "<0.01", "Normal sinus rhythm". Empty for a report without one. */
  readonly value: string;
  readonly impression?: string;
  readonly findings?: string;
  /** Where it was done. */
  readonly facility?: string;
  /** The doctor who ordered or read it. */
  readonly providerId?: string | null;
  /** Uploaded documents that hold this result. */
  readonly fileIds?: readonly string[];
  readonly note: string;
  readonly source: Source;
  readonly aiRunId: string | null;
}

export interface Symptom {
  readonly name: string;
  readonly bodyArea: string;
  /** 0 to 10, or null when not rated. */
  readonly severity: number | null;
}

/** How she is doing at one moment: the status log a caregiver keeps between visits. */
export interface CheckIn {
  readonly id: string;
  readonly at: LocalDateTime;
  /** 1 (very bad) to 5 (very good). */
  readonly overall: number | null;
  /** 1 (no energy) to 5 (full energy). */
  readonly energy: number | null;
  readonly symptoms: readonly Symptom[];
  readonly bpSys: number | null;
  readonly bpDia: number | null;
  readonly heartRate: number | null;
  readonly temperatureF: string | null;
  readonly weightLb: string | null;
  readonly glucose: string | null;
  readonly note: string;
  readonly source: Source;
  readonly aiRunId: string | null;
  /** Who logged it. */
  readonly by?: string;
}

export const MEAL_KINDS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "DRINK"] as const;
export type MealKind = (typeof MEAL_KINDS)[number];

/** One entry in her food log. */
export interface Meal {
  readonly id: string;
  readonly at: LocalDateTime;
  readonly kind: MealKind;
  readonly description: string;
  readonly note: string;
  readonly source: Source;
  readonly aiRunId: string | null;
  readonly by?: string;
}

/** Her weight goal and the plan the family is following. Weight itself is logged in check-ins. */
export interface DietGoal {
  readonly goalWeightLb: string | null;
  readonly goalDate: LocalDate | null;
  readonly plan: string;
}

/** A document uploaded and kept on this computer, in data/documents. */
export const READ_STATUSES = ["READ", "EMPTY", "FAILED", "UNSUPPORTED"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

/** What code found when it read an uploaded file. The text itself sits next to the file, not in the record. */
export interface FileRead {
  readonly status: ReadStatus;
  /** CCDA: a health-record export; PDF: text in a PDF; OCR: text recognized in an image or a scanned page. */
  readonly method: "CCDA" | "PDF" | "OCR" | "TEXT" | null;
  /** The document's own title, such as "Summary of Care". */
  readonly title: string;
  /** The visit or report date, when the document gives one. */
  readonly date: LocalDate | null;
  /** One line about the visit: type, doctor, place. */
  readonly summary: string;
  readonly chars: number;
  readonly pages: number | null;
  /** Why it could not be read. */
  readonly note: string;
  readonly readAt: LocalDateTime;
}

export interface StoredFile {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  /** The file's name inside data/documents. */
  readonly stored: string;
  readonly uploadedAt: LocalDateTime;
  readonly by?: string;
  /** Absent until the file has been read. */
  readonly read?: FileRead;
}

export const QUESTION_STATUSES = ["OPEN", "ASKED", "DROPPED"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** A question to ask a doctor, usually at a specific appointment. */
export interface Question {
  readonly id: string;
  readonly text: string;
  readonly appointmentId: string | null;
  readonly relatedIds: readonly string[];
  readonly status: QuestionStatus;
  readonly answer: string;
  readonly createdAt: LocalDateTime;
  readonly source: Source;
  readonly aiRunId: string | null;
  /** Who added it. */
  readonly by?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly at: LocalDateTime;
  /** The person's words; empty for an assistant message, whose content is its AI run. */
  readonly text: string;
  readonly runId: string | null;
  /** Who asked, for a person's message. Absent in records written before sharing existed. */
  readonly by?: string;
  readonly byRole?: Role;
}

export interface Thread {
  readonly id: string;
  readonly title: string;
  readonly createdAt: LocalDateTime;
  readonly messages: readonly ChatMessage[];
}

/** A document a person pasted, such as an after-visit summary or a lab report. */
export interface ImportDoc {
  readonly id: string;
  readonly label: string;
  readonly date: LocalDate | null;
  readonly text: string;
  readonly createdAt: LocalDateTime;
  readonly runIds: readonly string[];
}

export const URGENCIES = ["INFO", "ROUTINE", "SOON", "TODAY", "EMERGENCY"] as const;
export type Urgency = (typeof URGENCIES)[number];

export type AiJob = "CHAT" | "EXTRACT";
export type AiStatus = "SUCCEEDED" | "INVALID" | "FAILED";

export interface ProposalDecision {
  readonly index: number;
  readonly decision: "ACCEPTED" | "DISMISSED";
  readonly at: LocalDateTime;
  readonly createdIds: readonly string[];
  /** Existing records the accepted proposal changed. Absent in files written before it was added. */
  readonly updatedIds?: readonly string[];
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

/** Every model call, kept whatever its outcome. An output changes nothing until a person accepts a proposal. */
export interface AiRun {
  readonly id: string;
  readonly job: AiJob;
  /** The thread or the imported document. */
  readonly subjectId: string;
  /** The record revision the model read. */
  readonly recordRevision: number;
  readonly provider: string;
  readonly model: string;
  readonly status: AiStatus;
  /** Why the run is INVALID or FAILED. */
  readonly reasons: readonly string[];
  /** Checks that did not invalidate the run but that a person should see. */
  readonly warnings: readonly string[];
  /** The validated output, or the raw parsed output of an INVALID run, for inspection. */
  readonly output: unknown;
  readonly floor: Urgency | null;
  readonly usage: AiUsage;
  readonly startedAt: LocalDateTime;
  readonly durationMs: number;
  readonly decisions: readonly ProposalDecision[];
}

export interface HealthState {
  readonly schema: 1;
  readonly revision: number;
  readonly updatedAt: LocalDateTime;
  readonly profile: Profile;
  /** Who may open ClearCare through Tailscale. Anyone on this computer always can. */
  readonly people: readonly Person[];
  readonly providers: readonly Provider[];
  readonly appointments: readonly Appointment[];
  readonly medications: readonly Medication[];
  readonly diagnoses: readonly Diagnosis[];
  readonly tests: readonly Test[];
  readonly results: readonly Result[];
  readonly checkIns: readonly CheckIn[];
  readonly questions: readonly Question[];
  readonly meals: readonly Meal[];
  readonly diet: DietGoal;
  readonly files: readonly StoredFile[];
  readonly threads: readonly Thread[];
  readonly imports: readonly ImportDoc[];
  readonly aiRuns: readonly AiRun[];
  /** The last number used for each ID prefix. */
  readonly counters: Readonly<Record<string, number>>;
}

/** ID prefixes, so a person and the model can tell what an ID points at. */
export const PREFIX = {
  provider: "PRV",
  appointment: "APT",
  medication: "MED",
  diagnosis: "DX",
  test: "TST",
  result: "RES",
  checkIn: "CHK",
  question: "Q",
  thread: "THR",
  message: "MSG",
  importDoc: "DOC",
  aiRun: "RUN",
  meal: "MEAL",
  file: "FILE",
} as const;

export function emptyState(now: LocalDateTime): HealthState {
  return {
    schema: 1,
    revision: 0,
    updatedAt: now,
    profile: { name: "Mom", birthYear: null, sex: null, allergies: [], emergencyContact: "", notes: "", sample: false },
    people: [],
    providers: [],
    appointments: [],
    medications: [],
    diagnoses: [],
    tests: [],
    results: [],
    checkIns: [],
    questions: [],
    meals: [],
    diet: { goalWeightLb: null, goalDate: null, plan: "" },
    files: [],
    threads: [],
    imports: [],
    aiRuns: [],
    counters: {},
  };
}

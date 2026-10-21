import { addDays, dateOf, daysBetween } from "./dates.js";
import { dietSummary, type DietSummary } from "./diet.js";
import { computeFacts, type Fact } from "./facts.js";
import { checkInText, redFlags, type RedFlagResult } from "./redflags.js";
import { summarizeTest, type TestSummary } from "./results.js";
import type { Appointment, CheckIn, HealthState, LocalDate, LocalDateTime, Medication, Question } from "./types.js";

/** Everything the pages show that needs a rule: computed once by the server, so the browser only formats it. */
export interface View {
  readonly today: LocalDate;
  readonly now: LocalDateTime;
  readonly upcoming: readonly Appointment[];
  readonly toBook: readonly Appointment[];
  readonly past: readonly Appointment[];
  /** Scheduled visits whose time has passed and that still need visit notes. */
  readonly needsNotes: readonly Appointment[];
  readonly tests: readonly TestSummary[];
  readonly dueTests: readonly TestSummary[];
  readonly flaggedTests: readonly TestSummary[];
  readonly activeMedications: readonly Medication[];
  readonly refills: readonly { readonly medication: Medication; readonly daysUntil: number }[];
  readonly openQuestions: readonly Question[];
  readonly checkIns: readonly { readonly checkIn: CheckIn; readonly flags: RedFlagResult }[];
  /** Red flags in check-ins from the last 48 hours. */
  readonly recentFlags: readonly { readonly checkIn: CheckIn; readonly flags: RedFlagResult }[];
  readonly feeling: readonly { readonly at: LocalDateTime; readonly overall: number | null; readonly energy: number | null; readonly id: string }[];
  readonly facts: readonly Fact[];
  readonly diet: DietSummary;
}

export function activeMedicationNames(state: HealthState): string[] {
  return state.medications.filter((m) => m.status === "ACTIVE").map((m) => m.name);
}

export function buildView(state: HealthState, today: LocalDate, now: LocalDateTime): View {
  const byStart = (a: Appointment, b: Appointment) => (a.start ?? "").localeCompare(b.start ?? "");
  const upcoming = state.appointments.filter((a) => a.status === "SCHEDULED" && a.start !== null && a.start >= now).sort(byStart);
  const needsNotes = state.appointments.filter((a) => a.status === "SCHEDULED" && a.start !== null && a.start < now).sort(byStart);
  const toBook = state.appointments
    .filter((a) => a.status === "TO_BOOK")
    .sort((a, b) => (a.bookBy ?? "9999").localeCompare(b.bookBy ?? "9999"));
  const past = state.appointments.filter((a) => a.status === "COMPLETED" || a.status === "CANCELLED").sort((a, b) => byStart(b, a));

  const tests = state.tests.map((t) => summarizeTest(state, t, today));
  const dueOrder = { NEVER_DONE: 1, OVERDUE: 0, DUE_SOON: 2, OK: 3 } as const;
  const dueTests = tests
    .filter((t) => t.due !== null && t.due.state !== "OK")
    .sort((a, b) => dueOrder[a.due!.state] - dueOrder[b.due!.state] || a.due!.daysUntil - b.due!.daysUntil);
  const flaggedTests = tests.filter((t) => t.flag === "HIGH" || t.flag === "LOW");

  const activeMedications = state.medications.filter((m) => m.status === "ACTIVE");
  const refills = activeMedications
    .filter((m) => m.refillDue !== null && daysBetween(today, m.refillDue) <= 7)
    .map((medication) => ({ medication, daysUntil: daysBetween(today, medication.refillDue!) }))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const context = { activeMedicationNames: activeMedicationNames(state) };
  const checkIns = state.checkIns
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((checkIn) => ({ checkIn, flags: redFlags(checkInText(checkIn), context) }));
  const since48h = addDays(today, -1);
  const recentFlags = checkIns.filter((c) => c.flags.level !== null && dateOf(c.checkIn.at) >= since48h);

  const since30 = addDays(today, -29);
  const feeling = state.checkIns
    .filter((c) => dateOf(c.at) >= since30 && (c.overall !== null || c.energy !== null))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => ({ at: c.at, overall: c.overall, energy: c.energy, id: c.id }));

  return {
    today,
    now,
    upcoming,
    toBook,
    past,
    needsNotes,
    tests,
    dueTests,
    flaggedTests,
    activeMedications,
    refills,
    openQuestions: state.questions.filter((q) => q.status === "OPEN"),
    checkIns,
    recentFlags,
    feeling,
    facts: computeFacts(state, today),
    diet: dietSummary(state, today),
  };
}

import { addFrequency, daysBetween } from "./dates.js";
import { compare, format, parseDecimal, subtract } from "./decimal.js";
import { invalid } from "./errors.js";
import * as check from "./check.js";
import type { DatePrecision, HealthState, LocalDate, Result, Test } from "./types.js";

/** Labs and vital signs are numbers with a range; scans, biopsies, procedures and screenings are written reports. */
export function isReportTest(test: Pick<Test, "kind" | "unit" | "refLow" | "refHigh">): boolean {
  if (test.kind === "LAB" || test.kind === "VITAL") return false;
  if (test.kind === "OTHER") return test.unit === "" && test.refLow === null && test.refHigh === null;
  return true;
}

/** A full date, a month ("2026-03") or a year ("2026"), as its first day and how exact it is. Null when empty. */
export function readPartialDate(value: unknown, field = "Date"): { readonly date: LocalDate; readonly precision: DatePrecision } | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw invalid(`${field} must be a date.`);
  const v = value.trim();
  if (/^\d{4}$/.test(v)) return { date: check.date(`${v}-01-01`, field)!, precision: "YEAR" };
  if (/^\d{4}-\d{2}$/.test(v)) return { date: check.date(`${v}-01`, field)!, precision: "MONTH" };
  return { date: check.date(v, field)!, precision: "DAY" };
}

/** The date as stored for a precision: the first of the month or year. */
export function dateAtPrecision(date: LocalDate, precision: DatePrecision): LocalDate {
  if (precision === "YEAR") return `${date.slice(0, 4)}-01-01`;
  if (precision === "MONTH") return `${date.slice(0, 7)}-01`;
  return date;
}

export type Flag = "HIGH" | "LOW" | "NORMAL";

/**
 * Compares a value with the reference range exactly. "<0.01" and ">60" count only when the bound decides the flag,
 * otherwise the flag is null, never a guess.
 */
export function resultFlag(value: string, refLow: string | null, refHigh: string | null): Flag | null {
  const parsed = parseDecimal(value);
  if (parsed === null) return null;
  const low = refLow === null ? null : parseDecimal(refLow)?.value ?? null;
  const high = refHigh === null ? null : parseDecimal(refHigh)?.value ?? null;
  if (low === null && high === null) return null;
  const v = parsed.value;
  switch (parsed.comparator) {
    case null:
      if (low !== null && compare(v, low) < 0) return "LOW";
      if (high !== null && compare(v, high) > 0) return "HIGH";
      return "NORMAL";
    case "<":
    case "<=":
    case "≤":
      if (low !== null && compare(v, low) <= 0) return "LOW";
      if (low === null && high !== null && compare(v, high) <= 0) return "NORMAL";
      return null;
    default:
      if (high !== null && compare(v, high) >= 0) return "HIGH";
      if (high === null && low !== null && compare(v, low) >= 0) return "NORMAL";
      return null;
  }
}

export type DueState = "OVERDUE" | "DUE_SOON" | "OK" | "NEVER_DONE";

export interface Due {
  readonly lastDate: LocalDate | null;
  readonly nextDate: LocalDate;
  /** Negative when overdue. */
  readonly daysUntil: number;
  readonly state: DueState;
}

/** When a test with a frequency is next due. Null when it has no frequency or is not active. */
export function testDue(test: Test, results: readonly Result[], today: LocalDate, soonDays = 14): Due | null {
  if (test.frequency === null || test.status !== "ACTIVE") return null;
  const last = results.filter((r) => r.testId === test.id).map((r) => r.date).sort().at(-1) ?? null;
  if (last === null) return { lastDate: null, nextDate: today, daysUntil: 0, state: "NEVER_DONE" };
  const nextDate = addFrequency(last, test.frequency);
  const daysUntil = daysBetween(today, nextDate);
  return { lastDate: last, nextDate, daysUntil, state: daysUntil < 0 ? "OVERDUE" : daysUntil <= soonDays ? "DUE_SOON" : "OK" };
}

export interface TestSummary {
  readonly test: Test;
  /** Newest first. */
  readonly results: readonly Result[];
  readonly latest: Result | null;
  readonly flag: Flag | null;
  readonly previous: Result | null;
  /** Exact change from the previous numeric result, such as "+0.3". */
  readonly delta: string | null;
  readonly direction: "UP" | "DOWN" | "SAME" | null;
  readonly due: Due | null;
}

export function summarizeTest(state: HealthState, test: Test, today: LocalDate): TestSummary {
  const results = state.results
    .filter((r) => r.testId === test.id)
    .slice()
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id, undefined, { numeric: true }) : b.date.localeCompare(a.date)));
  const latest = results[0] ?? null;
  const previous = results[1] ?? null;
  let delta: string | null = null;
  let direction: TestSummary["direction"] = null;
  if (latest !== null && previous !== null && !isReportTest(test)) {
    const a = parseDecimal(latest.value);
    const b = parseDecimal(previous.value);
    if (a !== null && b !== null && a.comparator === null && b.comparator === null) {
      const d = subtract(a.value, b.value);
      direction = d.units > 0n ? "UP" : d.units < 0n ? "DOWN" : "SAME";
      delta = `${d.units > 0n ? "+" : ""}${format(d)}`;
    }
  }
  return {
    test,
    results,
    latest,
    flag: latest === null || isReportTest(test) ? null : resultFlag(latest.value, test.refLow, test.refHigh),
    previous,
    delta,
    direction,
    due: testDue(test, state.results, today),
  };
}

export function rangeText(test: Test): string {
  if (test.refLow !== null && test.refHigh !== null) return `${test.refLow}–${test.refHigh}`;
  if (test.refLow !== null) return `${test.refLow} or more`;
  if (test.refHigh !== null) return `${test.refHigh} or less`;
  return "";
}

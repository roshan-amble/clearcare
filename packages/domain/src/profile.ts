import { dietSummary } from "./diet.js";
import { parseDecimal, toChartNumber } from "./decimal.js";
import type { HealthState, LocalDate } from "./types.js";

/** Age and BMI, worked out by code from the profile and the latest logged weight. */
export interface ProfileSummary {
  readonly age: number | null;
  /** True when only the birth year is known. */
  readonly ageApproximate: boolean;
  readonly heightText: string | null;
  readonly latestWeightLb: string | null;
  readonly bmi: string | null;
}

export function ageOn(birthDate: LocalDate, today: LocalDate): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function heightText(inches: string | null | undefined): string | null {
  if (inches === null || inches === undefined) return null;
  const n = Number(inches);
  if (!Number.isFinite(n)) return null;
  const feet = Math.floor(n / 12);
  const rest = Math.round((n - feet * 12) * 10) / 10;
  return `${feet}′ ${rest}″`;
}

export function profileSummary(state: HealthState, today: LocalDate): ProfileSummary {
  const p = state.profile;
  const age = p.birthDate ? ageOn(p.birthDate, today) : p.birthYear === null ? null : Number(today.slice(0, 4)) - p.birthYear;
  const latest = dietSummary(state, today).latest;
  const height = p.heightIn === null || p.heightIn === undefined ? null : parseDecimal(p.heightIn);
  let bmi: string | null = null;
  if (latest !== null && height !== null && height.comparator === null) {
    const inches = toChartNumber(height.value);
    // BMI in US units: 703 × pounds / inches², one decimal.
    if (inches > 0) bmi = ((703 * latest.n) / (inches * inches)).toFixed(1);
  }
  return { age, ageApproximate: !p.birthDate && p.birthYear !== null, heightText: heightText(p.heightIn), latestWeightLb: latest?.lb ?? null, bmi };
}

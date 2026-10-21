import { invalid } from "./errors.js";
import type { Frequency, LocalDate, LocalDateTime } from "./types.js";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

export function isDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null) return false;
  const [, y, m, d, hh, mm] = match;
  return isDate(`${y}-${m}-${d}`) && Number(hh) < 24 && Number(mm) < 60;
}

export function dateOf(value: LocalDateTime | LocalDate): LocalDate {
  return value.slice(0, 10);
}

function toUtc(date: LocalDate): Date {
  if (!isDate(date)) throw invalid(`"${date}" is not a date (YYYY-MM-DD).`);
  return new Date(`${date}T00:00:00Z`);
}

const fromUtc = (date: Date): LocalDate => date.toISOString().slice(0, 10);

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Adds months the way a clinic counts them: Jan 31 plus 1 month is the last day of February. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = toUtc(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}

export function addFrequency(date: LocalDate, frequency: Frequency): LocalDate {
  switch (frequency.unit) {
    case "DAY":
      return addDays(date, frequency.every);
    case "WEEK":
      return addDays(date, frequency.every * 7);
    case "MONTH":
      return addMonths(date, frequency.every);
    case "YEAR":
      return addMonths(date, frequency.every * 12);
  }
}

/** Whole days from a to b: positive when b is later. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function frequencyText(frequency: Frequency): string {
  const unit = frequency.unit.toLowerCase();
  return frequency.every === 1 ? `every ${unit}` : `every ${frequency.every} ${unit}s`;
}

/** Local wall-clock date and time of a JavaScript Date, in the machine's time zone. */
export function localNow(date: Date): LocalDateTime {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

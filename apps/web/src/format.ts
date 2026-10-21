import { daysBetween, type HealthState, type LocalDate, type LocalDateTime, type Urgency } from "@clearcare/domain";

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

const utc = (value: string): Date => new Date(`${value.length === 10 ? `${value}T00:00` : value}:00Z`);

export const fmtDate = (date: LocalDate | null): string => (date === null ? "" : dateFmt.format(utc(date)));
export const fmtShort = (date: LocalDate): string => shortFmt.format(utc(date));
const yearFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** "May 14, 2014": a date with no weekday, for things in the past or far ahead. */
export const fmtPlain = (date: LocalDate | null): string => (date === null ? "" : yearFmt.format(utc(date)));
/** "Oct 17", or "Oct 28, 2025" when the year is not this year. */
export const fmtShortYear = (date: LocalDate): string => (date.slice(0, 4) === String(new Date().getFullYear()) ? shortFmt.format(utc(date)) : yearFmt.format(utc(date)));
export const fmtTime = (at: LocalDateTime): string => timeFmt.format(utc(at));
export const fmtDateTime = (at: LocalDateTime | null): string => (at === null ? "" : `${dateFmt.format(utc(at))} · ${timeFmt.format(utc(at))}`);

/** "today", "tomorrow", "in 6 days", "3 days ago". */
export function relDays(today: LocalDate, date: LocalDate): string {
  const days = daysBetween(today, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const STATUS_LABEL: Record<string, string> = {
  TO_BOOK: "To book",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ACTIVE: "Active",
  PAUSED: "Paused",
  STOPPED: "Stopped",
  MONITORING: "Monitoring",
  MANAGED: "Managed",
  RESOLVED: "Resolved",
  OPEN: "Open",
  ASKED: "Asked",
  DROPPED: "Dropped",
};

export const statusLabel = (status: string | null): string => (status === null ? "" : STATUS_LABEL[status] ?? status);

export const URGENCY: Record<Urgency, { readonly label: string; readonly icon: string }> = {
  EMERGENCY: { label: "Call 911 now", icon: "alert" },
  TODAY: { label: "Call the doctor today", icon: "phone" },
  SOON: { label: "Book a visit soon", icon: "calendar" },
  ROUTINE: { label: "Mention it at the next visit", icon: "note" },
  INFO: { label: "For your information", icon: "info" },
};

/** Where a record ID is shown. */
export function recordHref(id: string): string {
  if (/^(APT|Q|CHK)-/.test(id)) return `/schedule#${id}`;
  if (/^PRV-/.test(id)) return `/settings#${id}`;
  if (/^MED-/.test(id)) return `/medications#${id}`;
  if (/^(DX|TST|RES)-/.test(id)) return `/conditions#${id}`;
  if (/^MEAL-/.test(id) || id === "DIET") return `/diet#${id}`;
  if (/^(FILE|DOC)-/.test(id)) return "/documents";
  if (/^THR-/.test(id)) return `/chat/${id}`;
  return "/profile";
}

const cut = (text: string, n = 48) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A short human name for any record ID. */
export function recordLabel(state: HealthState, id: string): string {
  if (id === "PROFILE") return "Her profile";
  if (id === "DIET") return "Diet goal";
  if (/^F\d+$/.test(id)) return "Computed fact";
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "APT":
      return cut(state.appointments.find((a) => a.id === id)?.title ?? id);
    case "PRV":
      return state.providers.find((p) => p.id === id)?.name ?? id;
    case "MED": {
      const m = state.medications.find((x) => x.id === id);
      return m === undefined ? id : `${m.name} ${m.dose}`.trim();
    }
    case "DX":
      return cut(state.diagnoses.find((d) => d.id === id)?.name ?? id);
    case "TST":
      return state.tests.find((t) => t.id === id)?.name ?? id;
    case "RES": {
      const r = state.results.find((x) => x.id === id);
      const t = r === undefined ? undefined : state.tests.find((x) => x.id === r.testId);
      return r === undefined ? id : `${t?.name ?? "Result"}, ${fmtShortYear(r.date)}`;
    }
    case "CHK": {
      const c = state.checkIns.find((x) => x.id === id);
      return c === undefined ? id : `Check-in ${fmtShortYear(c.at.slice(0, 10))}`;
    }
    case "Q":
      return cut(state.questions.find((q) => q.id === id)?.text ?? id);
    case "MEAL":
      return cut(state.meals.find((m) => m.id === id)?.description ?? id);
    case "FILE": {
      const f = state.files.find((x) => x.id === id);
      return f === undefined ? id : fileLabel(f);
    }
    default:
      return id;
  }
}

export const money = (usd: number | null): string => (usd === null ? "" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);
export const thousands = (n: number): string => n.toLocaleString();

/** A day, or "March 2026" when only the month is known, or "2026". */
export function fmtPartialDate(date: string, precision?: string): string {
  const p = precision ?? (/^\d{4}$/.test(date) ? "YEAR" : /^\d{4}-\d{2}$/.test(date) ? "MONTH" : "DAY");
  if (p === "YEAR") return date.slice(0, 4);
  if (p === "MONTH") return new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return fmtPlain(date);
}

export const fmtResultDate = (r: { readonly date: string; readonly datePrecision?: string }): string => fmtPartialDate(r.date, r.datePrecision ?? "DAY");

export const KIND_LABEL: Record<string, string> = {
  LAB: "Lab",
  VITAL: "Vital sign",
  IMAGING: "Scan",
  PATHOLOGY: "Biopsy",
  PROCEDURE: "Procedure",
  SCREENING: "Screening",
  OTHER: "Other",
};

/** What a document is, in words: its title and date when code read them, else its file name. */
export function fileLabel(f: { readonly name: string; readonly read?: { readonly title: string; readonly date: string | null; readonly summary: string; readonly method: string | null } }): string {
  const r = f.read;
  if (r === undefined || r.method !== "CCDA") return f.name;
  const what = r.summary.split(" · ")[0] || r.title;
  return r.date === null ? what : `${what}, ${fmtPlain(r.date)}`;
}

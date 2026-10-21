import { addDays, dateOf, daysBetween, frequencyText } from "./dates.js";
import { dietSummary } from "./diet.js";
import { rangeText, summarizeTest } from "./results.js";
import type { CheckIn, HealthState, LocalDate, Medication } from "./types.js";

/**
 * Facts computed by code from the record: timing, counts, averages, due dates. The AI reads them and may cite them,
 * but it never computes a number itself (the ClearSpend principle: code handles numbers, AI handles text).
 */
export interface Fact {
  readonly id: string;
  readonly kind: "TIMING" | "SYMPTOM" | "TREND" | "VITALS" | "WEIGHT" | "DUE" | "RESULT" | "REFILL" | "APPOINTMENT";
  readonly text: string;
  readonly refs: readonly string[];
}

/** Days before a new symptom in which a medication change counts as "close in time". */
export const TIMING_WINDOW_DAYS = 30;

const normalize = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");
/** Words that are not a place on the body, so "Fatigue (general)" stays the same symptom as "Fatigue". */
const NOT_A_PLACE = new Set(["", "general", "whole body", "overall", "all over", "body", "n/a", "none"]);
const symptomKey = (name: string, bodyArea: string): string => {
  const area = normalize(bodyArea);
  return normalize(NOT_A_PLACE.has(area) ? name : `${name} (${bodyArea})`);
};
/** At most this many timing links, keeping the ones closest in time. */
export const TIMING_LIMIT = 12;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const daysText = (n: number): string => plural(n, "day");

interface MedEvent {
  readonly med: Medication;
  readonly date: LocalDate;
  readonly what: string;
}

function medicationEvents(state: HealthState): MedEvent[] {
  const events: MedEvent[] = [];
  for (const med of state.medications) {
    const label = `${med.name}${med.dose === "" ? "" : ` ${med.dose}`}`;
    if (med.startDate !== null) events.push({ med, date: med.startDate, what: `${label} was started` });
    for (const change of med.history) {
      if (change.from === null) continue;
      if (change.note.startsWith("Changed")) {
        events.push({ med, date: dateOf(change.at), what: `${med.name} was changed (${change.note.slice("Changed ".length)})` });
      } else if (change.from !== change.to) {
        const verb = change.to === "ACTIVE" ? "restarted" : change.to === "PAUSED" ? "paused" : "stopped";
        events.push({ med, date: dateOf(change.at), what: `${med.name} was ${verb}` });
      }
    }
  }
  return events;
}

interface Occurrence {
  readonly date: LocalDate;
  readonly checkIn: CheckIn;
  readonly severity: number | null;
}

function symptomOccurrences(state: HealthState): Map<string, Occurrence[]> {
  const byName = new Map<string, Occurrence[]>();
  const sorted = state.checkIns.slice().sort((a, b) => a.at.localeCompare(b.at));
  for (const checkIn of sorted) {
    for (const symptom of checkIn.symptoms) {
      const key = symptomKey(symptom.name, symptom.bodyArea);
      byName.set(key, [...(byName.get(key) ?? []), { date: dateOf(checkIn.at), checkIn, severity: symptom.severity }]);
    }
  }
  return byName;
}

function average(values: readonly number[]): string {
  const sum = values.reduce((a, b) => a + b, 0);
  // One decimal, rounded half up, from integers.
  const tenths = Math.round((sum * 10) / values.length);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function computeFacts(state: HealthState, today: LocalDate): Fact[] {
  const facts: Omit<Fact, "id">[] = [];
  const events = medicationEvents(state);
  const occurrences = symptomOccurrences(state);

  // Timing: a symptom that is new (not logged in the 30 days before) and a medication change shortly before it.
  const timing: (Omit<Fact, "id"> & { readonly gap: number; readonly onset: string })[] = [];
  for (const [name, list] of occurrences) {
    for (let i = 0; i < list.length; i++) {
      const occurrence = list[i]!;
      const recentBefore = list.slice(0, i).some((o) => daysBetween(o.date, occurrence.date) <= 30);
      if (recentBefore || daysBetween(occurrence.date, today) > 90) continue;
      for (const event of events) {
        const gap = daysBetween(event.date, occurrence.date);
        if (gap < 0 || gap > TIMING_WINDOW_DAYS) continue;
        timing.push({
          gap,
          onset: occurrence.date,
          kind: "TIMING",
          text: `"${name}" was first logged on ${occurrence.date} (${occurrence.checkIn.id}), ${daysText(gap)} after ${event.what} on ${event.date} (${event.med.id}).`,
          refs: [occurrence.checkIn.id, event.med.id],
        });
      }
    }
  }
  // Keep the links closest in time, then show them in date order.
  const kept = timing
    .slice()
    .sort((a, b) => a.gap - b.gap)
    .slice(0, TIMING_LIMIT)
    .sort((a, b) => a.onset.localeCompare(b.onset));
  facts.push(...kept.map(({ kind, text, refs }) => ({ kind, text, refs })));

  // Symptoms in the last 30 days against the 30 days before.
  const since30 = addDays(today, -29);
  const since60 = addDays(today, -59);
  for (const [name, list] of occurrences) {
    const recent = list.filter((o) => o.date >= since30 && o.date <= today);
    if (recent.length === 0) continue;
    const before = list.filter((o) => o.date >= since60 && o.date < since30).length;
    const severities = recent.map((o) => o.severity).filter((s): s is number => s !== null);
    const worst = severities.length === 0 ? "" : `; worst severity ${Math.max(...severities)}/10`;
    facts.push({
      kind: "SYMPTOM",
      text: `"${name}" was logged ${plural(recent.length, "time")} in the last 30 days (${before === 0 ? "none" : before} in the 30 days before)${worst}; last on ${recent.at(-1)!.date}.`,
      refs: recent.slice(-6).map((o) => o.checkIn.id),
    });
  }

  // Ratings: the last 7 days against the 23 days before.
  const since7 = addDays(today, -6);
  for (const field of ["overall", "energy"] as const) {
    const rated = state.checkIns.filter((c) => c[field] !== null);
    const last = rated.filter((c) => dateOf(c.at) >= since7 && dateOf(c.at) <= today);
    const prior = rated.filter((c) => dateOf(c.at) >= since30 && dateOf(c.at) < since7);
    if (last.length === 0 || prior.length === 0) continue;
    const a = average(last.map((c) => c[field]!));
    const b = average(prior.map((c) => c[field]!));
    const direction = a === b ? "the same as" : Number(a) < Number(b) ? "down from" : "up from";
    facts.push({
      kind: "TREND",
      text: `The ${field === "overall" ? "overall feeling" : "energy"} rating averaged ${a}/5 over the last 7 days (${plural(last.length, "check-in")}), ${direction} ${b}/5 in the 23 days before (${plural(prior.length, "check-in")}).`,
      refs: last.map((c) => c.id),
    });
  }

  // Home vitals in the last 14 days.
  const since14 = addDays(today, -13);
  const recentVitals = state.checkIns.filter((c) => dateOf(c.at) >= since14 && dateOf(c.at) <= today).sort((a, b) => a.at.localeCompare(b.at));
  const bp = recentVitals.filter((c) => c.bpSys !== null && c.bpDia !== null);
  const highBp = bp.filter((c) => c.bpSys! >= 140 || c.bpDia! >= 90);
  if (highBp.length > 0) {
    const latest = bp.at(-1)!;
    facts.push({
      kind: "VITALS",
      text: `Blood pressure was 140/90 or higher in ${highBp.length} of ${plural(bp.length, "reading")} in the last 14 days; the latest was ${latest.bpSys}/${latest.bpDia} on ${dateOf(latest.at)} (${latest.id}).`,
      refs: highBp.slice(-6).map((c) => c.id),
    });
  }
  const hr = recentVitals.filter((c) => c.heartRate !== null);
  const slow = hr.filter((c) => c.heartRate! < 55);
  const fast = hr.filter((c) => c.heartRate! > 100);
  if (slow.length > 0) {
    facts.push({
      kind: "VITALS",
      text: `Heart rate was under 55 in ${slow.length} of ${plural(hr.length, "reading")} in the last 14 days (lowest ${Math.min(...slow.map((c) => c.heartRate!))}).`,
      refs: slow.slice(-6).map((c) => c.id),
    });
  }
  if (fast.length > 0) {
    facts.push({
      kind: "VITALS",
      text: `Heart rate was over 100 in ${fast.length} of ${plural(hr.length, "reading")} in the last 14 days (highest ${Math.max(...fast.map((c) => c.heartRate!))}).`,
      refs: fast.slice(-6).map((c) => c.id),
    });
  }

  // Weight and the diet goal.
  const diet = dietSummary(state, today);
  if (diet.latest !== null) {
    const parts = [`The latest weight was ${diet.latest.lb} lb on ${dateOf(diet.latest.at)} (${diet.latest.id}).`];
    if (diet.sixMonths !== null) parts.push(`Over about 6 months, since ${diet.sixMonths.from.lb} lb on ${dateOf(diet.sixMonths.from.at)}, it changed ${diet.sixMonths.change} lb, about ${diet.sixMonths.perWeek} lb a week.`);
    if (diet.thirtyDays !== null) parts.push(`Over about 30 days it changed ${diet.thirtyDays.change} lb.`);
    facts.push({ kind: "WEIGHT", text: parts.join(" "), refs: [diet.latest.id] });
  }
  if (diet.goal !== null) {
    const g = diet.goal;
    const parts = [`The weight goal is ${g.lb} lb${g.date === null ? "" : ` by ${g.date}`}.`];
    if (g.toGo !== null) parts.push(Number(g.toGo) > 0 ? `${g.toGo} lb to go.` : "The goal has been reached.");
    if (g.perWeekNeeded !== null && Number(g.toGo) > 0) parts.push(`That needs about ${g.perWeekNeeded} lb a week over the ${g.weeksLeft} weeks left.`);
    facts.push({ kind: "WEIGHT", text: parts.join(" "), refs: [] });
  }

  // Tests: due dates and flagged results.
  for (const test of state.tests) {
    const summary = summarizeTest(state, test, today);
    const due = summary.due;
    if (due !== null && test.frequency !== null) {
      if (due.state === "NEVER_DONE") {
        facts.push({ kind: "DUE", text: `${test.name} (${test.id}) should be done ${frequencyText(test.frequency)} and has no result in the record.`, refs: [test.id] });
      } else if (due.state === "OVERDUE") {
        facts.push({
          kind: "DUE",
          text: `${test.name} (${test.id}) is overdue by ${daysText(-due.daysUntil)}: last done ${due.lastDate}, due ${frequencyText(test.frequency)}.`,
          refs: [test.id],
        });
      } else if (due.state === "DUE_SOON") {
        facts.push({ kind: "DUE", text: `${test.name} (${test.id}) is due on ${due.nextDate}, in ${daysText(due.daysUntil)}.`, refs: [test.id] });
      }
    }
    if (summary.latest !== null && (summary.flag === "HIGH" || summary.flag === "LOW")) {
      const unit = test.unit === "" ? "" : ` ${test.unit}`;
      const change =
        summary.previous === null || summary.delta === null
          ? ""
          : summary.direction === "SAME"
            ? `, the same as on ${summary.previous.date}`
            : `, ${summary.direction === "UP" ? "up" : "down"} ${summary.delta.replace(/^[+-]/, "")} from ${summary.previous.value} on ${summary.previous.date}`;
      facts.push({
        kind: "RESULT",
        text: `The latest ${test.name} (${summary.latest.id}) was ${summary.latest.value}${unit} on ${summary.latest.date}: ${summary.flag} against the reference ${rangeText(test)}${change}.`,
        refs: [summary.latest.id, test.id],
      });
    }
  }

  // Refills.
  for (const med of state.medications) {
    if (med.status !== "ACTIVE" || med.refillDue === null) continue;
    const days = daysBetween(today, med.refillDue);
    if (days <= 7) {
      facts.push({
        kind: "REFILL",
        text: days < 0 ? `${med.name} (${med.id}) refill was due ${daysText(-days)} ago, on ${med.refillDue}.` : `${med.name} (${med.id}) refill is due on ${med.refillDue}, in ${daysText(days)}.`,
        refs: [med.id],
      });
    }
  }

  // Appointments that need a person.
  for (const appointment of state.appointments) {
    if (appointment.status === "TO_BOOK" && appointment.bookBy !== null && appointment.bookBy < today) {
      facts.push({ kind: "APPOINTMENT", text: `"${appointment.title}" (${appointment.id}) was to be booked by ${appointment.bookBy} and is still not booked.`, refs: [appointment.id] });
    }
    if (appointment.status === "SCHEDULED" && appointment.start !== null && dateOf(appointment.start) < today) {
      facts.push({
        kind: "APPOINTMENT",
        text: `"${appointment.title}" (${appointment.id}) was scheduled for ${dateOf(appointment.start)} and has no visit notes yet.`,
        refs: [appointment.id],
      });
    }
  }

  return facts.map((fact, i) => ({ id: `F${i + 1}`, ...fact }));
}

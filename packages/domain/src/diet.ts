import { addDays, dateOf, daysBetween } from "./dates.js";
import { format, parseDecimal, subtract, toChartNumber } from "./decimal.js";
import type { HealthState, LocalDate, LocalDateTime } from "./types.js";

/**
 * Weight and diet, computed by code. Weight is logged in check-ins (weightLb); the goal is in state.diet. Every number
 * here comes from exact decimal arithmetic on what was logged, so the model and the page show the same figures.
 */
export interface WeightPoint {
  readonly id: string;
  readonly at: LocalDateTime;
  readonly lb: string;
  /** For drawing only. */
  readonly n: number;
}

export interface WeightChange {
  readonly from: WeightPoint;
  readonly to: WeightPoint;
  /** Signed, exact: "+15.0" style without forced decimals, such as "+15" or "-2.4". */
  readonly change: string;
  readonly weeks: number;
  /** Signed pounds per week, one decimal. */
  readonly perWeek: string;
}

export interface DietSummary {
  readonly points: readonly WeightPoint[];
  readonly latest: WeightPoint | null;
  readonly sixMonths: WeightChange | null;
  readonly thirtyDays: WeightChange | null;
  /** From the first logged reading to the latest, when there are two or more. */
  readonly sinceFirst: WeightChange | null;
  readonly goal: {
    readonly lb: string;
    readonly date: LocalDate | null;
    /** Pounds still to lose (negative means below the goal). */
    readonly toGo: string | null;
    readonly weeksLeft: number | null;
    readonly perWeekNeeded: string | null;
  } | null;
}

const signed = (s: string): string => (s.startsWith("-") ? s : s === "0" ? "0" : `+${s}`);

function between(from: WeightPoint, to: WeightPoint): WeightChange {
  const a = parseDecimal(from.lb)!.value;
  const b = parseDecimal(to.lb)!.value;
  const change = subtract(b, a);
  const days = Math.max(1, daysBetween(dateOf(from.at), dateOf(to.at)));
  const weeks = Math.round((days / 7) * 10) / 10;
  const perWeek = (toChartNumber(change) / (days / 7)).toFixed(1);
  return { from, to, change: signed(format(change)), weeks, perWeek: signed(perWeek === "-0.0" ? "0.0" : perWeek) };
}

/** The reading closest to a date, if one falls within 21 days of it either way. */
function readingNear(points: readonly WeightPoint[], date: LocalDate): WeightPoint | null {
  let best: WeightPoint | null = null;
  let gap = Infinity;
  for (const p of points) {
    const d = Math.abs(daysBetween(dateOf(p.at), date));
    if (d <= 21 && d < gap) {
      best = p;
      gap = d;
    }
  }
  return best;
}

export function weightPoints(state: HealthState): WeightPoint[] {
  return state.checkIns
    .filter((c) => c.weightLb !== null && parseDecimal(c.weightLb) !== null)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => ({ id: c.id, at: c.at, lb: c.weightLb!, n: toChartNumber(parseDecimal(c.weightLb!)!.value) }));
}

export function dietSummary(state: HealthState, today: LocalDate): DietSummary {
  const points = weightPoints(state);
  const latest = points.at(-1) ?? null;
  const at = (days: number) => (latest === null ? null : readingNear(points.filter((p) => dateOf(p.at) < dateOf(latest.at)), addDays(dateOf(latest.at), -days)));
  const six = at(182);
  const thirty = at(30);
  let goal: DietSummary["goal"] = null;
  const goalLb = state.diet.goalWeightLb;
  if (goalLb !== null && parseDecimal(goalLb) !== null) {
    const toGo = latest === null ? null : format(subtract(parseDecimal(latest.lb)!.value, parseDecimal(goalLb)!.value));
    const weeksLeft = state.diet.goalDate === null ? null : Math.max(0, Math.round((daysBetween(today, state.diet.goalDate) / 7) * 10) / 10);
    const perWeekNeeded = toGo === null || weeksLeft === null || weeksLeft === 0 ? null : (Number(toGo) / weeksLeft).toFixed(1);
    goal = { lb: goalLb, date: state.diet.goalDate, toGo, weeksLeft, perWeekNeeded };
  }
  return {
    points,
    latest,
    sixMonths: latest === null || six === null ? null : between(six, latest),
    thirtyDays: latest === null || thirty === null ? null : between(thirty, latest),
    sinceFirst: latest === null || points.length < 2 ? null : between(points[0]!, latest),
    goal,
  };
}

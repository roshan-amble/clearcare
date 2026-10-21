/**
 * Exact decimal text, as labs print it. Values are compared and subtracted as scaled integers, never as floating
 * point, so 0.1 + 0.2 problems cannot change a flag.
 */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

const NUMBER = /^\s*([<>]=?|≤|≥)?\s*(-?)(\d+)(?:\.(\d+))?\s*$/;

/** Parses "7.4", "<0.01", "> 60". Returns null for text that is not a single number. */
export function parseDecimal(text: string): { readonly value: Decimal; readonly comparator: string | null } | null {
  const match = NUMBER.exec(text.replace(/,/g, ""));
  if (match === null) return null;
  const [, comparator, sign, whole, fraction = ""] = match;
  const units = BigInt(`${sign}${whole}${fraction}`);
  return { value: { units, scale: fraction.length }, comparator: comparator ?? null };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.units * 10n ** BigInt(scale - a.scale), b.units * 10n ** BigInt(scale - b.scale), scale];
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b);
  return { units: x - y, scale };
}

export function format(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale);
  const fraction = digits.slice(digits.length - value.scale);
  return `${negative ? "-" : ""}${whole}${value.scale > 0 ? `.${fraction}` : ""}`;
}

/** For drawing only: a chart needs a position, never a decision. */
export function toChartNumber(value: Decimal): number {
  return Number(value.units) / 10 ** value.scale;
}

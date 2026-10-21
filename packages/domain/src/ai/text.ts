/** Text helpers for checking what a model quotes against what was sent. */

/** Lowercase, straight quotes, plain dashes, single spaces. Quotes are compared in this form. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[’‘`]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the quote, without surrounding quotes or a trailing period, appears in the source. */
export function quoteFound(source: string, quote: string): boolean {
  const q = normalizeText(quote).replace(/^["'.\s]+|["'.,;:\s]+$/g, "");
  if (q.length < 2) return false;
  return normalizeText(source).includes(q);
}

const MEASURE = /\b(\d+(?:\.\d+)?)\s?(mg\/dl|mmol\/l|mmhg|mcg|mg|ml|bpm|units?|iu|%)(?![a-z])/gi;
const READING = /\b(\d{2,3})\s?\/\s?(\d{2,3})\b/g;
/** A blood pressure starts at 60 or more; "10/24" is a date. */
const isReading = (systolic: string): boolean => Number(systolic) >= 60;

/** Measurements in a text, such as "50 mg", "7.4%", "148/92", normalized without spaces. */
export function measurements(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MEASURE)) found.push(`${match[1]}${match[2]!.toLowerCase()}`);
  for (const match of text.matchAll(READING)) if (isReading(match[1]!)) found.push(`${match[1]}/${match[2]}`);
  return found;
}

/** Measurements in the answer that appear neither in the record nor in what the person wrote. */
export function unsupportedMeasurements(answer: string, sources: readonly string[]): string[] {
  const known = new Set(sources.flatMap(measurements));
  const compactSources = sources.map((s) => normalizeText(s).replace(/\s/g, ""));
  return [...new Set(measurements(answer))].filter((m) => !known.has(m) && !compactSources.some((s) => s.includes(m)));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string field; records a reason when it is missing. */
export function str(value: unknown, field: string, reasons: string[], options: { readonly max?: number; readonly required?: boolean } = {}): string {
  if (typeof value !== "string") {
    reasons.push(`${field} is not text.`);
    return "";
  }
  const trimmed = value.trim();
  if (options.required !== false && trimmed === "") reasons.push(`${field} is empty.`);
  if (trimmed.length > (options.max ?? 4000)) reasons.push(`${field} is longer than ${options.max ?? 4000} characters.`);
  return trimmed;
}

export function nullableStr(value: unknown, field: string, reasons: string[], max = 300): string | null {
  if (value === null || value === undefined) return null;
  const s = str(value, field, reasons, { max, required: false });
  return s === "" ? null : s;
}

export function arr(value: unknown, field: string, reasons: string[], max: number): unknown[] {
  if (!Array.isArray(value)) {
    reasons.push(`${field} is not a list.`);
    return [];
  }
  if (value.length > max) reasons.push(`${field} has ${value.length} items; at most ${max} are allowed.`);
  return value.slice(0, max);
}

export function intOrNull(value: unknown, field: string, reasons: string[], min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    reasons.push(`${field} must be a whole number from ${min} to ${max}.`);
    return null;
  }
  return value;
}

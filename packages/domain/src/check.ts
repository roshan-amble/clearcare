import { isDate, isDateTime } from "./dates.js";
import { invalid } from "./errors.js";

/** Small input checks shared by commands and AI validators. Each throws a DomainError naming the field. */

export function text(value: unknown, field: string, options: { readonly required?: boolean; readonly max?: number } = {}): string {
  if (value === undefined || value === null) {
    if (options.required === true) throw invalid(`${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw invalid(`${field} must be text.`);
  const trimmed = value.trim();
  if (options.required === true && trimmed === "") throw invalid(`${field} is required.`);
  const max = options.max ?? 4000;
  if (trimmed.length > max) throw invalid(`${field} is longer than ${max} characters.`);
  return trimmed;
}

export function optionalText(value: unknown, field: string, max = 200): string | null {
  const result = text(value, field, { max });
  return result === "" ? null : result;
}

export function integer(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) throw invalid(`${field} must be a whole number.`);
  if (n < min || n > max) throw invalid(`${field} must be between ${min} and ${max}.`);
  return n;
}

export function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isDate(value)) throw invalid(`${field} must be a date (YYYY-MM-DD).`);
  return value;
}

export function dateTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isDateTime(value)) throw invalid(`${field} must be a date and time (YYYY-MM-DDTHH:mm).`);
  return value;
}

export function oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw invalid(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function list(value: unknown, field: string, max = 50): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be a list.`);
  if (value.length > max) throw invalid(`${field} has more than ${max} items.`);
  return value;
}

export function textList(value: unknown, field: string, max = 50): string[] {
  return list(value, field, max)
    .map((item, i) => text(item, `${field} ${i + 1}`, { max: 200 }))
    .filter((item) => item !== "");
}

/** A decimal as text, such as "7.4" or "120". */
export function decimalText(value: unknown, field: string): string | null {
  const result = optionalText(value, field, 40);
  if (result === null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(result.replace(/,/g, ""))) throw invalid(`${field} must be a number, such as 7.4.`);
  return result.replace(/,/g, "");
}

export function bool(value: unknown): boolean {
  return value === true;
}

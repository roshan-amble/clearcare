import { describe, expect, it } from "vitest";
import { CHAT_SCHEMA, EXTRACT_SCHEMA } from "@clearcare/domain";
import { forOpenAI } from "./openai.js";

/** Walks a schema and reports what OpenAI's strict mode needs: objects closed, every property required, no const. */
function problems(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => problems(s, `${path}[${i}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Record<string, unknown>;
  const out: string[] = [];
  if ("const" in s) out.push(`${path} uses const`);
  if (s["type"] === "object") {
    if (s["additionalProperties"] !== false) out.push(`${path} is not closed`);
    const props = Object.keys((s["properties"] as object | undefined) ?? {});
    const required = (s["required"] as string[] | undefined) ?? [];
    for (const p of props) if (!required.includes(p)) out.push(`${path}.${p} is not required`);
  }
  for (const [k, v] of Object.entries(s)) out.push(...problems(v, `${path}.${k}`));
  return out;
}

describe("OpenAI schemas", () => {
  it("meets strict mode for the chat and the document reader", () => {
    expect(problems(forOpenAI(CHAT_SCHEMA))).toEqual([]);
    expect(problems(forOpenAI(EXTRACT_SCHEMA))).toEqual([]);
    expect((forOpenAI(CHAT_SCHEMA) as { type: string }).type).toBe("object");
  });
  it("turns const into a one-value enum", () => {
    expect(forOpenAI({ type: "string", const: "SAVE" })).toEqual({ type: "string", enum: ["SAVE"] });
  });
});

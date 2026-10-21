import OpenAI from "openai";
import type { Effort } from "../config.js";
import type { AiCall, AiProvider, AiResult } from "./provider.js";

/** OpenAI's strict mode does not list "const"; a one-value enum says the same thing. */
export function forOpenAI(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forOpenAI);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "const") out["enum"] = [value];
    else out[key] = forOpenAI(value);
  }
  return out;
}

/**
 * Calls the OpenAI Responses API with a strict JSON schema. The instructions go first and the record next, so OpenAI's
 * automatic prompt caching can reuse them across a conversation. Responses are not stored on OpenAI's side
 * (store: false). The domain validators check every answer exactly as they do for Claude.
 */
export class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly description: string;
  readonly chatEffort: string;
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
    private readonly efforts: { readonly chat: Effort; readonly extract: Effort },
    private readonly mode: "standard" | "pro",
  ) {
    this.client = new OpenAI({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 });
    this.chatEffort = efforts.chat;
    this.description = `OpenAI · ${model}${mode === "pro" ? " (pro mode)" : ""}`;
  }

  async call(request: AiCall): Promise<AiResult> {
    const empty = { inputTokens: 0, outputTokens: 0, costUsd: null };
    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: request.system,
        input: [{ role: "user", content: request.context }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))],
        text: {
          format: {
            type: "json_schema",
            name: request.job === "chat" ? "clearcare_answer" : "clearcare_extraction",
            schema: forOpenAI(request.schema) as Record<string, unknown>,
            strict: true,
          },
        },
        reasoning: { effort: this.efforts[request.job], ...(this.mode === "pro" ? { mode: "pro" } : {}) },
        max_output_tokens: 32000,
        store: false,
      });
      const usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, costUsd: null };
      if (response.status === "incomplete") {
        return { ok: false, error: `The answer stopped early (${response.incomplete_details?.reason ?? "no reason given"}).`, usage, model: response.model };
      }
      for (const item of response.output) {
        if (item.type !== "message") continue;
        for (const part of item.content) {
          if (part.type === "refusal") return { ok: false, error: `The model declined: ${part.refusal}`, usage, model: response.model };
        }
      }
      try {
        return { ok: true, output: JSON.parse(response.output_text) as unknown, usage, model: response.model };
      } catch {
        return { ok: false, error: "The answer was not valid JSON.", usage, model: response.model };
      }
    } catch (error) {
      if (error instanceof OpenAI.AuthenticationError) return { ok: false, error: "OpenAI rejected the API key. Check the key in your Keychain.", usage: empty, model: this.model };
      if (error instanceof OpenAI.RateLimitError) {
        // A 429 is either a real rate limit or an account with no credit; OpenAI's code says which.
        const billing = error.code === "insufficient_quota" || error.code === "credit_balance_exhausted" || /credit|quota|billing/i.test(error.message);
        const why = billing ? "The OpenAI account has no credit left. Add credit at platform.openai.com, under Billing." : "OpenAI rate limit reached. Wait a minute and try again.";
        return { ok: false, error: `${why} (${error.code ?? "429"}: ${error.message})`, usage: empty, model: this.model };
      }
      if (error instanceof OpenAI.NotFoundError) return { ok: false, error: `OpenAI has no model "${this.model}" for this key. Set CLEARCARE_OPENAI_MODEL.`, usage: empty, model: this.model };
      if (error instanceof OpenAI.BadRequestError) return { ok: false, error: `OpenAI refused the request: ${error.message}`, usage: empty, model: this.model };
      if (error instanceof OpenAI.APIConnectionError) return { ok: false, error: "Could not reach OpenAI.", usage: empty, model: this.model };
      if (error instanceof OpenAI.APIError) return { ok: false, error: `OpenAI error ${String(error.status)}: ${error.message}`, usage: empty, model: this.model };
      return { ok: false, error: error instanceof Error ? error.message : String(error), usage: empty, model: this.model };
    }
  }
}

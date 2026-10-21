import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@clearcare/domain";
import { config } from "../config.js";
import type { AiCall, AiProvider, AiResult } from "./provider.js";

/** List prices in dollars per million tokens, for the run log. Null cost for a model not listed here. */
const PRICES: Record<string, { readonly input: number; readonly output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

function usageOf(model: string, usage: Anthropic.Beta.BetaUsage): AiUsage {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const price = PRICES[model];
  // Cache writes cost 1.25 times the input price (5-minute cache), cache reads 0.05 times on Opus 5.5.
  const costUsd =
    price === undefined
      ? null
      : (usage.input_tokens * price.input + cacheWrite * price.input * 1.25 + cacheRead * price.input * 0.05 + usage.output_tokens * price.output) / 1_000_000;
  return { inputTokens: usage.input_tokens + cacheWrite + cacheRead, outputTokens: usage.output_tokens, costUsd };
}

/**
 * Calls the Messages API with the official SDK. Adaptive thinking is always on for Claude Opus 5.5, so effort is the
 * control. Structured output constrains the JSON; the domain validators still check every field. Server-side
 * fallbacks ("default") retry a safety-classifier decline on the model Anthropic recommends for that category.
 */
export class AnthropicApiProvider implements AiProvider {
  readonly name = "api" as const;
  readonly description: string;
  readonly chatEffort = config.ai.chatEffort;
  private readonly client = new Anthropic();

  constructor(readonly model: string) {
    this.description = `Anthropic API · ${model}`;
  }

  async call(request: AiCall): Promise<AiResult> {
    const empty = { inputTokens: 0, outputTokens: 0, costUsd: null };
    try {
      const message = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: request.job === "chat" ? config.ai.chatEffort : config.ai.extractEffort, format: { type: "json_schema", schema: request.schema as Record<string, unknown> } },
          system: [
            { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.context, cache_control: { type: "ephemeral" } },
          ],
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        })
        .finalMessage();
      const usage = usageOf(message.model, message.usage);
      if (message.stop_reason === "refusal") {
        const category = message.stop_details?.category ?? "unspecified";
        return { ok: false, error: `Claude declined this request (category: ${category}).`, usage, model: message.model };
      }
      if (message.stop_reason === "max_tokens") return { ok: false, error: "The answer was cut off at the output limit.", usage, model: message.model };
      const text = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      try {
        return { ok: true, output: JSON.parse(text) as unknown, usage, model: message.model };
      } catch {
        return { ok: false, error: "The answer was not valid JSON.", usage, model: message.model };
      }
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "The API key was rejected. Check ANTHROPIC_API_KEY.", usage: empty, model: this.model };
      if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "Rate limited by the API. Wait a minute and retry.", usage: empty, model: this.model };
      if (error instanceof Anthropic.BadRequestError) return { ok: false, error: `The API refused the request: ${error.message}`, usage: empty, model: this.model };
      if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "Could not reach the Anthropic API.", usage: empty, model: this.model };
      if (error instanceof Anthropic.APIError) return { ok: false, error: `API error ${String(error.status)}: ${error.message}`, usage: empty, model: this.model };
      return { ok: false, error: error instanceof Error ? error.message : String(error), usage: empty, model: this.model };
    }
  }
}

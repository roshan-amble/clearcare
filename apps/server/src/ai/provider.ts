import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiUsage } from "@clearcare/domain";
import { config } from "../config.js";
import { AnthropicApiProvider } from "./anthropic.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { CodexCliProvider } from "./codex-cli.js";
import { OPENAI_KEY_COMMAND, openAiKey } from "./keys.js";
import { OpenAIProvider } from "./openai.js";

/** One model call: stable instructions, the record as context, the turns, and the output schema. */
export interface AiCall {
  readonly system: string;
  readonly context: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly schema: object;
  /** Each engine picks its own effort for the job. */
  readonly job: "chat" | "extract";
}

export type AiResult =
  | { readonly ok: true; readonly output: unknown; readonly usage: AiUsage; readonly model: string }
  | { readonly ok: false; readonly error: string; readonly usage: AiUsage; readonly model: string };

export interface AiProvider {
  readonly name: "api" | "cli" | "openai" | "codex";
  readonly model: string;
  readonly description: string;
  readonly chatEffort: string;
  call(request: AiCall): Promise<AiResult>;
}

export interface ProviderChoice {
  readonly provider: AiProvider | null;
  /** Why there is no provider, or which one was chosen. */
  readonly note: string;
}

export const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: null };

function findClaude(): string | null {
  if (config.ai.claudeBin !== null) return existsSync(config.ai.claudeBin) ? config.ai.claudeBin : null;
  const dirs = [...(process.env["PATH"] ?? "").split(path.delimiter), path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".claude/local")];
  for (const dir of dirs) {
    const candidate = path.join(dir, "claude");
    if (dir !== "" && existsSync(candidate)) return candidate;
  }
  return null;
}

function findCodex(): string | null {
  if (config.codex.bin !== null) return existsSync(config.codex.bin) ? config.codex.bin : null;
  const dirs = [...(process.env["PATH"] ?? "").split(path.delimiter), path.join(os.homedir(), "homebrew/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const dir of dirs) {
    const candidate = path.join(dir, "codex");
    if (dir !== "" && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Whether Codex is signed in, and how. */
function codexLogin(bin: string): string | null {
  // Codex prints its status on stderr, so read both streams.
  const result = spawnSync(bin, ["login", "status"], { encoding: "utf8", timeout: 15000 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || out === "" || /not logged in/i.test(out)) return null;
  return out.split("\n").at(-1)!.trim();
}

export function chooseProvider(): ProviderChoice {
  const mode = config.ai.mode;
  if (mode === "off") return { provider: null, note: "AI is off (CLEARCARE_AI=off)." };
  const openai = () => {
    const key = openAiKey();
    if (key === null) return null;
    const o = config.openai;
    return new OpenAIProvider(o.model, key, { chat: o.chatEffort, extract: o.extractEffort }, o.mode);
  };
  const codex = (): ProviderChoice => {
    const bin = findCodex();
    if (bin === null) return { provider: null, note: "Codex is not installed. Install it with: brew install --cask codex" };
    const login = codexLogin(bin);
    if (login === null) return { provider: null, note: "Codex is not signed in. In a Terminal window, run: codex login  and sign in with your ChatGPT account." };
    const c = config.codex;
    return { provider: new CodexCliProvider(c.model, bin, { chat: c.chatEffort, extract: c.extractEffort }), note: `Your ChatGPT plan, through Codex. ${login}.` };
  };
  if (mode === "codex") return codex();
  if (mode === "openai") {
    const provider = openai();
    return provider === null
      ? { provider: null, note: `No OpenAI key yet. Add it with ${OPENAI_KEY_COMMAND}.` }
      : { provider, note: "OpenAI, with the key from your Keychain or OPENAI_API_KEY." };
  }
  if (mode === "auto") {
    const provider = openai();
    if (provider !== null) return { provider, note: "OpenAI, with the key from your Keychain or OPENAI_API_KEY." };
  }
  const hasKey = (process.env["ANTHROPIC_API_KEY"] ?? "") !== "" || (process.env["ANTHROPIC_AUTH_TOKEN"] ?? "") !== "";
  if (mode === "api" || (mode === "auto" && hasKey)) {
    if (!hasKey) return { provider: null, note: "CLEARCARE_AI=api, but ANTHROPIC_API_KEY is not set." };
    return { provider: new AnthropicApiProvider(config.ai.model), note: "Anthropic API, with the key from ANTHROPIC_API_KEY." };
  }
  if (mode === "auto") {
    const viaCodex = codex();
    if (viaCodex.provider !== null) return viaCodex;
  }
  const bin = findClaude();
  if (bin === null) {
    return { provider: null, note: `No AI engine: add an OpenAI key (${OPENAI_KEY_COMMAND}), set ANTHROPIC_API_KEY, or install the Claude CLI.` };
  }
  return { provider: new ClaudeCliProvider(config.ai.model, bin), note: `The Claude CLI at ${bin}, with its signed-in account.` };
}

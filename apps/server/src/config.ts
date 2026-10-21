import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const effort = (value: string | undefined, fallback: Effort): Effort =>
  value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : fallback;

/** Settings come from environment variables only. A key or token is never written to a file. */
export const config = {
  port: Number(process.env["PORT"] ?? 8091),
  /** Localhost only by default: the record is private health data. */
  host: process.env["HOST"] ?? "127.0.0.1",
  /** The port only Tailscale Serve forwards to; 0 turns sharing off. Always bound to 127.0.0.1. */
  tailnetPort: Number(process.env["CLEARCARE_TAILNET_PORT"] ?? 0),
  dataDir: path.resolve(process.env["CLEARCARE_DATA_DIR"] ?? path.join(repoRoot, "data")),
  webDist: path.join(repoRoot, "apps/web/dist"),
  ai: {
    /**
     * codex: your ChatGPT plan through the Codex CLI. openai: the OpenAI API with a key. Either one alone, never
     * another engine. auto: OpenAI key, else Anthropic key, else Codex if signed in, else the Claude CLI.
     */
    mode: (process.env["CLEARCARE_AI"] ?? "auto") as "auto" | "codex" | "openai" | "api" | "cli" | "off",
    model: process.env["CLEARCARE_MODEL"] ?? "claude-opus-5-5",
    chatEffort: effort(process.env["CLEARCARE_EFFORT"], "high"),
    extractEffort: effort(process.env["CLEARCARE_EXTRACT_EFFORT"], "medium"),
    claudeBin: process.env["CLAUDE_BIN"] ?? null,
  },
  codex: {
    model: process.env["CLEARCARE_CODEX_MODEL"] ?? "gpt-6.1-sol",
    chatEffort: effort(process.env["CLEARCARE_CODEX_EFFORT"], "medium"),
    extractEffort: effort(process.env["CLEARCARE_CODEX_EXTRACT_EFFORT"], "medium"),
    bin: process.env["CODEX_BIN"] ?? null,
  },
  openai: {
    /** OpenAI's newest top-tier model as of 2026-10-19. */
    model: process.env["CLEARCARE_OPENAI_MODEL"] ?? "gpt-6.1-sol",
    chatEffort: effort(process.env["CLEARCARE_OPENAI_EFFORT"], "high"),
    extractEffort: effort(process.env["CLEARCARE_OPENAI_EXTRACT_EFFORT"], "medium"),
    mode: (process.env["CLEARCARE_OPENAI_MODE"] === "pro" ? "pro" : "standard") as "standard" | "pro",
  },
} as const;

import { spawn } from "node:child_process";
import os from "node:os";
import { config } from "../config.js";
import type { AiCall, AiProvider, AiResult } from "./provider.js";

/** Variables that mark a process as running inside Claude Code; a nested CLI must not inherit them. */
const SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
];

const TIMEOUT_MS = 6 * 60 * 1000;

interface CliResult {
  readonly is_error?: boolean;
  readonly subtype?: string;
  readonly result?: string;
  readonly structured_output?: unknown;
  readonly total_cost_usd?: number;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly cache_creation_input_tokens?: number; readonly cache_read_input_tokens?: number };
  readonly modelUsage?: Record<string, unknown>;
}

/**
 * Runs the Claude CLI in headless mode with no tools, no plugins, hooks or MCP servers, no saved session, and a JSON
 * schema for the output. It uses the account the CLI is signed in to. The record goes in on stdin, never on the
 * command line, so it does not show in the process list.
 */
export class ClaudeCliProvider implements AiProvider {
  readonly name = "cli" as const;
  readonly description: string;
  readonly chatEffort = config.ai.chatEffort;

  constructor(
    readonly model: string,
    private readonly bin: string,
  ) {
    this.description = `Claude CLI · ${model}`;
  }

  call(request: AiCall): Promise<AiResult> {
    const transcript = request.messages.slice(0, -1);
    const last = request.messages.at(-1)?.content ?? "";
    const history =
      transcript.length === 0
        ? ""
        : `<conversation_so_far>\n${transcript.map((m) => `<turn role="${m.role === "user" ? "caregiver" : "assistant"}">\n${m.content}\n</turn>`).join("\n")}\n</conversation_so_far>\n\n`;
    const prompt = `${request.context}\n\n${history}${last}`;
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(request.schema),
      "--tools",
      "",
      "--safe-mode",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--model",
      this.model,
      "--effort",
      request.job === "chat" ? config.ai.chatEffort : config.ai.extractEffort,
      "--system-prompt",
      request.system,
    ];
    const env = { ...process.env };
    for (const name of SESSION_VARIABLES) delete env[name];

    return new Promise((resolve) => {
      const empty = { inputTokens: 0, outputTokens: 0, costUsd: null };
      const child = spawn(this.bin, args, { cwd: os.tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `Could not start the Claude CLI: ${error.message}`, usage: empty, model: this.model });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        let parsed: CliResult;
        try {
          parsed = JSON.parse(stdout) as CliResult;
        } catch {
          const why = signal === "SIGTERM" ? "it took longer than 6 minutes" : `exit code ${String(code)}: ${(stderr || stdout).trim().slice(0, 400)}`;
          resolve({ ok: false, error: `The Claude CLI failed (${why}).`, usage: empty, model: this.model });
          return;
        }
        const u = parsed.usage ?? {};
        const usage = {
          inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
          costUsd: parsed.total_cost_usd ?? null,
        };
        const model = Object.keys(parsed.modelUsage ?? {})[0] ?? this.model;
        if (parsed.is_error === true || parsed.subtype !== "success") {
          resolve({ ok: false, error: `The Claude CLI reported an error: ${(parsed.result ?? parsed.subtype ?? "unknown").slice(0, 400)}`, usage, model });
          return;
        }
        if (parsed.structured_output === undefined) {
          resolve({ ok: false, error: "The Claude CLI returned no structured output.", usage, model });
          return;
        }
        resolve({ ok: true, output: parsed.structured_output, usage, model });
      });
      child.stdin.end(prompt);
    });
  }
}

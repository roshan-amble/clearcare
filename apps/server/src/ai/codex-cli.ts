import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Effort } from "../config.js";
import { forOpenAI } from "./openai.js";
import type { AiCall, AiProvider, AiResult } from "./provider.js";

/** Everything an agent could do besides answering. ClearCare only needs the answer. */
const NO_TOOLS = [
  "shell_tool",
  "unified_exec",
  "apps",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "hooks",
  "goals",
  "view_image",
  "tool_suggest",
  "skill_search",
  "sleep_tool",
  "in_app_browser",
];

const TIMEOUT_MS = 8 * 60 * 1000;

const PREAMBLE =
  "You are answering inside ClearCare, a private health record app. Do not run commands, read files, browse, or use any tool: everything you need is in this message. Follow the instructions in <instructions>, then reply with the JSON answer only.";

interface CodexUsage {
  readonly input_tokens?: number;
  readonly cached_input_tokens?: number;
  readonly output_tokens?: number;
}

/**
 * Runs `codex exec` signed in with the person's ChatGPT account, so answers count against their ChatGPT plan instead
 * of API credit. Each call starts in an empty temporary folder, saves no session, ignores the person's Codex config,
 * and switches off every tool. The record goes in on stdin, never on the command line.
 */
export class CodexCliProvider implements AiProvider {
  readonly name = "codex" as const;
  readonly description: string;
  readonly chatEffort: string;

  constructor(
    readonly model: string,
    private readonly bin: string,
    private readonly efforts: { readonly chat: Effort; readonly extract: Effort },
  ) {
    this.chatEffort = efforts.chat;
    this.description = `ChatGPT plan (Codex) · ${model}`;
  }

  async call(request: AiCall): Promise<AiResult> {
    const empty = { inputTokens: 0, outputTokens: 0, costUsd: null };
    const dir = await mkdtemp(path.join(os.tmpdir(), "clearcare-codex-"));
    try {
      const schemaFile = path.join(dir, "schema.json");
      const outFile = path.join(dir, "answer.json");
      await writeFile(schemaFile, JSON.stringify(forOpenAI(request.schema)), { mode: 0o600 });
      const transcript = request.messages.slice(0, -1);
      const last = request.messages.at(-1)?.content ?? "";
      const prompt = [
        PREAMBLE,
        `<instructions>\n${request.system}\n</instructions>`,
        request.context,
        transcript.length === 0
          ? ""
          : `<conversation_so_far>\n${transcript.map((m) => `<turn role="${m.role === "user" ? "person" : "assistant"}">\n${m.content}\n</turn>`).join("\n")}\n</conversation_so_far>`,
        last,
      ]
        .filter((part) => part !== "")
        .join("\n\n");
      const args = [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--cd",
        dir,
        "--output-schema",
        schemaFile,
        "--output-last-message",
        outFile,
        "--json",
        "--color",
        "never",
        "--model",
        this.model,
        "-c",
        `model_reasoning_effort="${this.efforts[request.job]}"`,
        "-c",
        'web_search="disabled"',
        ...NO_TOOLS.flatMap((feature) => ["--disable", feature]),
        "-",
      ];
      const { code, stdout, stderr, timedOut } = await run(this.bin, args, prompt, dir);

      let usage = empty as { inputTokens: number; outputTokens: number; costUsd: null };
      let failure: string | null = null;
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const event = JSON.parse(line) as { type?: string; usage?: CodexUsage; message?: string; error?: { message?: string } };
          if (event.usage !== undefined) {
            usage = { inputTokens: event.usage.input_tokens ?? 0, outputTokens: event.usage.output_tokens ?? 0, costUsd: null };
          }
          if (event.type === "error" && typeof event.message === "string") failure = event.message;
          if (event.type === "turn.failed") failure = event.error?.message ?? "the turn failed";
        } catch {
          // Not an event line.
        }
      }
      if (timedOut) return { ok: false, error: "Codex took longer than 8 minutes.", usage, model: this.model };
      let text: string;
      try {
        text = await readFile(outFile, "utf8");
      } catch {
        const why = failure ?? (stderr.trim().split("\n").at(-1) || `exit code ${String(code)}`);
        return { ok: false, error: `Codex gave no answer: ${why.slice(0, 400)}`, usage, model: this.model };
      }
      try {
        return { ok: true, output: JSON.parse(text) as unknown, usage, model: this.model };
      } catch {
        return { ok: false, error: "Codex's answer was not valid JSON.", usage, model: this.model };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), usage: empty, model: this.model };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function run(bin: string, args: string[], input: string, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Codex: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(input);
  });
}

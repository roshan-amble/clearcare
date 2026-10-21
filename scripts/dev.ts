import { spawn, type ChildProcess } from "node:child_process";

/** Runs the API (restarting on change) and the web app together. Open http://127.0.0.1:8090. */
const children: ChildProcess[] = [];

function start(name: string, command: string, args: string[], env: Record<string, string> = {}): void {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => `[${name}] ${line}`)
      .join("\n");
  child.stdout?.on("data", (chunk: Buffer) => console.log(prefix(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => console.error(prefix(chunk)));
  child.on("exit", (code) => {
    console.log(`[${name}] stopped (${String(code)})`);
    shutdown();
  });
  children.push(child);
}

function shutdown(): void {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start("api", "node_modules/.bin/tsx", ["watch", "--clear-screen=false", "apps/server/src/main.ts"], { PORT: process.env["API_PORT"] ?? "8091" });
start("web", "node_modules/.bin/vite", ["--config", "apps/web/vite.config.ts", "apps/web"]);
console.log("ClearCare: open http://127.0.0.1:8090");

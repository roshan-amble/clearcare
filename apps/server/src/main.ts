import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import {
  addFile,
  addImportDoc,
  FILE_LIMIT_BYTES,
  removeFile,
  setFileRead,
  appendMessage,
  applyCommand,
  buildView,
  check,
  decideProposal,
  DomainError,
  emptyState,
  sampleState,
  startThread,
  type Command,
  type HealthState,
  type StoredFile,
} from "@clearcare/domain";
import { chooseProvider } from "./ai/provider.js";
import { clock } from "./clock.js";
import { config } from "./config.js";
import { DocumentReader } from "./documents.js";
import { BusyError, runChat, runExtract } from "./jobs.js";
import { Store } from "./store.js";
import { hostAllowed, resolveViewer, type Channel, type Viewer } from "./viewer.js";

const store = await Store.open(config.dataDir, clock().now);
const { provider, note: providerNote } = chooseProvider();
const extraHosts = new Set((process.env["CLEARCARE_ALLOWED_HOSTS"] ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => h !== ""));

/** People seen through Tailscale since this server started, so the log notes each one once. */
const signedIn = new Set<string>();

/** Tailscale logins refused recently, so the owner can add the right one. Kept in memory only. */
const refused = new Map<string, string>();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function payload(state: HealthState, viewer: Viewer, extra: Record<string, unknown> = {}) {
  const { now, today } = clock();
  return {
    state,
    view: buildView(state, today, now),
    ai: { available: provider !== null, provider: provider?.name ?? null, description: provider?.description ?? null, model: provider?.model ?? null, chatEffort: provider?.chatEffort ?? null, note: providerNote },
    dataFile: viewer.local ? store.file : null,
    viewer,
    sharing: { tailnetPort: config.tailnetPort > 0 ? config.tailnetPort : null },
    refusedLogins: viewer.local ? [...refused].map(([login, at]) => ({ login, at })) : [],
    ...extra,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new HttpError(413, "The request is too large.");
    chunks.push(chunk as Buffer);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
  return body as Record<string, unknown>;
}

/** Compresses a response when the browser accepts it: about a third of the bytes over a slow Tailscale relay. */
function compressed(req: IncomingMessage, body: Buffer): { readonly body: Buffer; readonly headers: Record<string, string> } {
  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (!accepts || body.length < 1024) return { body, headers: {} };
  return { body: gzipSync(body, { level: 6 }), headers: { "content-encoding": "gzip", vary: "accept-encoding" } };
}

/** Each response's own request, so a reply sent a minute later still knows what that browser accepts. */
const requestOf = new WeakMap<ServerResponse, IncomingMessage>();

function send(res: ServerResponse, status: number, body: unknown): void {
  const raw = Buffer.from(JSON.stringify(body));
  const req = requestOf.get(res);
  const out = req === undefined ? { body: raw, headers: {} } : compressed(req, raw);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...out.headers });
  res.end(out.body);
}

/** Refuses requests that a web page on another site could make through a browser (DNS rebinding, CSRF). */
function checkOrigin(req: IncomingMessage, channel: Channel): void {
  if (!hostAllowed(channel, req.headers.host, extraHosts)) throw new HttpError(403, "This server only answers its own address.");
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "null") {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, "Bad origin.");
    }
    if (!hostAllowed(channel, host, extraHosts)) throw new HttpError(403, "Requests from other sites are refused.");
  }
}

/** The person behind a request, or a refusal that remembers the login for the owner. */
function viewerFor(req: IncomingMessage, channel: Channel): Viewer {
  const result = resolveViewer(channel, req.headers, store.get());
  if (result.ok) {
    if (!result.viewer.local && !signedIn.has(result.viewer.name)) {
      signedIn.add(result.viewer.name);
      console.log(`${clock().now} Signed in through Tailscale: ${result.viewer.name}`);
    }
    return result.viewer;
  }
  // Logged so a person who cannot get in can be told why. Only this machine can read the log.
  console.log(`${clock().now} Turned away at the Tailscale door: ${result.login ?? "a request with no Tailscale login"}`);
  if (result.login !== null) {
    refused.delete(result.login);
    refused.set(result.login, clock().now);
    while (refused.size > 10) refused.delete(refused.keys().next().value!);
  }
  throw new HttpError(
    403,
    result.login === null
      ? "Open ClearCare through its Tailscale link while signed in to Tailscale."
      : `${result.login} is not on ClearCare's list. Ask the person who runs it to add this login in Settings.`,
  );
}

function localOnly(viewer: Viewer, what: string): void {
  if (!viewer.local) throw new HttpError(403, `${what} can only be done on the computer that runs ClearCare.`);
}

function hasHealthData(state: HealthState): boolean {
  return (
    state.providers.length + state.appointments.length + state.medications.length + state.diagnoses.length + state.tests.length + state.checkIns.length + state.questions.length >
    0
  );
}

async function api(req: IncomingMessage, res: ServerResponse, pathname: string, channel: Channel): Promise<void> {
  checkOrigin(req, channel);
  const viewer = viewerFor(req, channel);
  const meta = { source: "PERSON" as const, aiRunId: null, by: viewer.name };
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/state") return send(res, 200, payload(store.get(), viewer));

  if (method === "GET" && pathname === "/api/export") {
    const { today } = clock();
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="clearcare-${today}.json"`,
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(store.get(), null, 2));
    return;
  }

  const fileMatch = /^\/api\/files\/(FILE-\d+)$/.exec(pathname);
  if (method === "GET" && fileMatch !== null) return sendFile(res, fileMatch[1]!);
  if (method === "POST" && pathname === "/api/files") {
    const file = await receiveFile(req, viewer);
    return send(res, 200, payload(store.get(), viewer, { fileId: file }));
  }

  if (method !== "POST") throw new HttpError(404, "Not found.");
  const body = await readJson(req);

  switch (pathname) {
    case "/api/command": {
      const command = body["command"] as Command;
      if (typeof command === "object" && command !== null && command.type === "people.save") localOnly(viewer, "Changing who can use ClearCare");
      const created = await store.update((state) => {
        const applied = applyCommand(state, command, clock().now, meta);
        return { state: applied.state, result: applied.createdIds };
      });
      return send(res, 200, payload(store.get(), viewer, { createdIds: created }));
    }
    case "/api/chat": {
      const text = check.text(body["text"], "Message", { required: true, max: 8000 });
      let threadId = typeof body["threadId"] === "string" && body["threadId"] !== "" ? body["threadId"] : null;
      threadId = await store.update((state) => {
        const { now } = clock();
        let current = state;
        let id = threadId;
        if (id === null) {
          const started = startThread(current, text, now);
          current = started.state;
          id = started.threadId;
        }
        return { state: appendMessage(current, id, { role: "user", text, runId: null, by: viewer.name, byRole: viewer.role }, now), result: id };
      });
      const runId = await runChat(store, provider, providerNote, threadId, docs);
      return send(res, 200, payload(store.get(), viewer, { threadId, runId }));
    }
    case "/api/chat/retry": {
      const threadId = check.text(body["threadId"], "Chat", { required: true, max: 40 });
      const runId = await runChat(store, provider, providerNote, threadId, docs);
      return send(res, 200, payload(store.get(), viewer, { threadId, runId }));
    }
    case "/api/import": {
      const label = check.text(body["label"], "Name of the document", { required: true, max: 200 });
      const date = check.date(body["date"], "Document date");
      const text = check.text(body["text"], "Document text", { required: true, max: 60_000 });
      const docId = await store.update((state) => {
        const added = addImportDoc(state, { label, date, text }, clock().now);
        return { state: added.state, result: added.docId };
      });
      const runId = await runExtract(store, provider, providerNote, docId);
      return send(res, 200, payload(store.get(), viewer, { docId, runId }));
    }
    case "/api/import/retry": {
      const docId = check.text(body["docId"], "Document", { required: true, max: 40 });
      const runId = await runExtract(store, provider, providerNote, docId);
      return send(res, 200, payload(store.get(), viewer, { docId, runId }));
    }
    case "/api/decide": {
      const decision = check.oneOf(body["decision"], "Decision", ["ACCEPT", "DISMISS"] as const);
      const index = check.integer(body["index"], "Index", 0, 100);
      if (index === null) throw new HttpError(400, "Index is required.");
      const runId = check.text(body["runId"], "Run", { required: true, max: 40 });
      const created = await store.update((state) => {
        const applied = decideProposal(state, runId, index, decision, body["edits"], clock().now, viewer.name);
        return { state: applied.state, result: applied.createdIds };
      });
      return send(res, 200, payload(store.get(), viewer, { createdIds: created }));
    }
    case "/api/files/delete": {
      const id = check.text(body["id"], "Document", { required: true, max: 40 });
      const removed = await store.update((state) => {
        const r = removeFile(state, id);
        return { state: r.state, result: r.file };
      });
      await rm(path.join(documentsDir, removed.stored), { force: true });
      await docs.remove(removed);
      return send(res, 200, payload(store.get(), viewer));
    }
    case "/api/sample": {
      localOnly(viewer, "Loading or clearing the sample");
      const action = check.oneOf(body["action"], "Action", ["load", "clear"] as const);
      await store.update((state) => {
        const { now } = clock();
        // The people list survives: it is who may use ClearCare, not health data.
        if (action === "load") {
          if (hasHealthData(state) && !state.profile.sample) throw new HttpError(409, "The record already has real data. The sample loads only into an empty record.");
          return { state: { ...sampleState(now), people: state.people, revision: state.revision + 1 }, result: null };
        }
        if (!state.profile.sample) throw new HttpError(409, "The record does not hold the sample, so nothing was cleared.");
        return { state: { ...emptyState(now), people: state.people, revision: state.revision + 1 }, result: null };
      });
      return send(res, 200, payload(store.get(), viewer));
    }
    default:
      throw new HttpError(404, "Not found.");
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Uploaded documents, kept in data/documents on this computer.

const documentsDir = path.join(config.dataDir, "documents");
const docs = new DocumentReader(documentsDir);

/** Reads a stored file and records what was found. Failures are recorded on the file, not thrown. */
async function readAndRecord(file: StoredFile): Promise<void> {
  const outcome = await docs.read(file, clock().now);
  await store.update((state) => ({ state: setFileRead(state, file.id, outcome.read), result: null }));
}

/** Files uploaded before reading existed, or whose reading was interrupted, are read once in the background. */
async function readUnread(): Promise<void> {
  for (const file of store.get().files) {
    if (file.read !== undefined && (file.read.status !== "READ" || docs.text(file) !== null)) continue;
    try {
      await readAndRecord(file);
    } catch (error) {
      console.error(`Reading ${file.id} failed:`, error);
    }
  }
}

/** Types a browser may show in the page. Anything else (HTML, SVG, scripts) downloads instead, so it cannot run. */
const INLINE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain; charset=utf-8",
};

/** Reads a raw upload (the file is the request body) to disk, refusing anything over the size limit. */
async function receiveFile(req: IncomingMessage, viewer: Viewer): Promise<string> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > FILE_LIMIT_BYTES) throw new HttpError(413, "Files can be at most 50 MB.");
  const rawName = String(req.headers["x-file-name"] ?? "document");
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    name = "document";
  }
  await mkdir(documentsDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(documentsDir, `.upload-${process.pid}-${Date.now()}`);
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp, { mode: 0o600 });
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > FILE_LIMIT_BYTES) {
        req.destroy();
        out.destroy();
        reject(new HttpError(413, "Files can be at most 50 MB."));
      }
    });
    req.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    req.pipe(out);
  }).catch(async (error: unknown) => {
    await rm(tmp, { force: true });
    throw error;
  });
  try {
    const file = await store.update((state) => {
      const added = addFile(state, { name, type: String(req.headers["content-type"] ?? ""), size, by: viewer.name }, clock().now);
      return { state: added.state, result: added.file };
    });
    await rename(tmp, path.join(documentsDir, file.stored));
    const stored = store.get().files.find((f) => f.id === file.id);
    if (stored !== undefined) await readAndRecord(stored);
    return file.id;
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

function sendFile(res: ServerResponse, id: string): void {
  const file = store.get().files.find((f) => f.id === id);
  const full = file === undefined ? null : path.join(documentsDir, file.stored);
  if (file === undefined || full === null || !existsSync(full)) throw new HttpError(404, "That document is not here.");
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  const inline = INLINE_TYPES[ext];
  res.writeHead(200, {
    "content-type": inline ?? "application/octet-stream",
    "content-disposition": `${inline === undefined ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "content-length": String(statSync(full).size),
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
    "cache-control": "private, no-store",
  });
  createReadStream(full).pipe(res);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Built files, read and compressed once. The app's files have hashed names, so a phone can keep them for good. */
const staticCache = new Map<string, { readonly raw: Buffer; readonly gzip: Buffer; readonly mtime: number }>();

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (!existsSync(config.webDist)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("The web app is not built. Run npm run dev, or npm start.");
    return;
  }
  const requested = path.normalize(path.join(config.webDist, decodeURIComponent(pathname)));
  const inside = requested.startsWith(config.webDist + path.sep);
  const file = inside && existsSync(requested) && statSync(requested).isFile() ? requested : path.join(config.webDist, "index.html");
  const mtime = statSync(file).mtimeMs;
  let entry = staticCache.get(file);
  if (entry === undefined || entry.mtime !== mtime) {
    const raw = readFileSync(file);
    entry = { raw, gzip: gzipSync(raw, { level: 9 }), mtime };
    staticCache.set(file, entry);
  }
  const hashed = file.startsWith(path.join(config.webDist, "assets") + path.sep);
  const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) && entry.raw.length >= 1024;
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}),
  });
  res.end(gzip ? entry.gzip : entry.raw);
}

function refusalPage(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClearCare</title>` +
      `<body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 20px;color:#161a17;background:#f2f3ef"><h1 style="font-size:20px">ClearCare</h1><p>${safe}</p></body>`,
  );
}

function handler(channel: Channel) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      try {
        checkOrigin(req, channel);
        viewerFor(req, channel);
      } catch (error) {
        if (error instanceof HttpError) return refusalPage(res, error.status, error.message);
        throw error;
      }
      serveStatic(req, res, url.pathname);
      return;
    }
    requestOf.set(res, req);
    api(req, res, url.pathname, channel).catch((error: unknown) => {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      if (error instanceof DomainError) return send(res, error.code === "NOT_FOUND" ? 404 : 400, { error: error.message });
      if (error instanceof BusyError) return send(res, 409, { error: error.message });
      if (error instanceof SyntaxError) return send(res, 400, { error: "The request is not valid JSON." });
      console.error(error);
      return send(res, 500, { error: error instanceof Error ? error.message : "Something went wrong." });
    });
  };
}

createServer(handler("local")).listen(config.port, config.host, () => {
  console.log(`ClearCare on http://${config.host}:${config.port}`);
  console.log(`Record: ${store.file}`);
  console.log(`AI: ${providerNote}`);
  void readUnread();
});

if (config.tailnetPort > 0) {
  // Only Tailscale Serve should reach this port, so it never listens beyond this machine.
  createServer(handler("tailnet")).listen(config.tailnetPort, "127.0.0.1", () => {
    console.log(`Tailscale door on http://127.0.0.1:${config.tailnetPort} (point tailscale serve here)`);
  });
}

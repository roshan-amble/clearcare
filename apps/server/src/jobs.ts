import {
  addRun,
  appendMessage,
  buildChatRequest,
  buildExtractRequest,
  validateChat,
  validateExtract,
  type AiRun,
  type AiStatus,
  type ChatOutput,
  type HealthState,
  type Thread,
} from "@clearcare/domain";
import { config } from "./config.js";
import { clock } from "./clock.js";
import { NO_USAGE, type AiProvider } from "./ai/provider.js";
import type { DocumentReader } from "./documents.js";
import type { Store } from "./store.js";

/**
 * The AI jobs. Each builds its input from the stored record only, calls the model, validates the output with the
 * domain rules, and stores one run whatever the outcome. No job changes health data.
 */

const busy = new Set<string>();

export class BusyError extends Error {}

function guard(subjectId: string): () => void {
  if (busy.has(subjectId)) throw new BusyError("Still answering here. Wait for the answer first.");
  busy.add(subjectId);
  return () => busy.delete(subjectId);
}

type RunBody = Omit<AiRun, "id" | "decisions">;

/** The thread up to its newest person message, for a first try or a retry. */
function threadForRequest(thread: Thread): Thread {
  const lastUser = thread.messages.map((m) => m.role).lastIndexOf("user");
  if (lastUser < 0) throw new Error("The chat has no message to answer.");
  return { ...thread, messages: thread.messages.slice(0, lastUser + 1) };
}

/**
 * Answers the newest message of a chat. The model reads the record with a listing of her documents and the text of
 * the ones that matter; when it asks for more documents by ID, they are sent and it is asked once more. Both runs
 * are stored; the thread shows the last.
 */
export async function runChat(store: Store, provider: AiProvider | null, providerNote: string, threadId: string, docs: DocumentReader | null = null): Promise<string> {
  const release = guard(threadId);
  try {
    const { now, today } = clock();
    const state = store.get();
    const thread = state.threads.find((t) => t.id === threadId);
    if (thread === undefined) throw new Error(`Chat ${threadId} is not in the record.`);
    const library = docs?.library(state.files) ?? null;
    const asked = threadForRequest(thread);

    const attempt = async (read: readonly string[]): Promise<RunBody> => {
      const request = buildChatRequest(state, asked, today, now, library, read);
      const started = Date.now();
      const base = {
        job: "CHAT" as const,
        subjectId: threadId,
        recordRevision: state.revision,
        provider: provider?.name ?? "none",
        startedAt: clock().now,
        floor: request.flags.level,
      };
      if (provider === null) {
        return { ...base, model: config.ai.model, status: "FAILED", reasons: [providerNote], warnings: [], output: null, usage: NO_USAGE, durationMs: 0 };
      }
      const result = await provider.call({ system: request.system, context: request.context, messages: request.messages, schema: request.schema, job: "chat" });
      const durationMs = Date.now() - started;
      if (!result.ok) {
        return { ...base, model: result.model, status: "FAILED", reasons: [result.error], warnings: [], output: null, usage: result.usage, durationMs };
      }
      // Validate against the record the model read, not a newer one.
      const checked = validateChat(result.output, request, state);
      return { ...base, model: result.model, status: checked.status as AiStatus, reasons: checked.reasons, warnings: checked.warnings, output: checked.output, usage: result.usage, durationMs };
    };

    let body = await attempt([]);
    const wanted = body.status === "SUCCEEDED" ? ((body.output as ChatOutput).readDocuments ?? []) : [];
    if (wanted.length > 0) {
      // Keep the first run, then ask again with those documents' full text.
      await store.update((current) => ({ state: addRun(current, body).state, result: null }));
      body = await attempt(wanted);
    }
    const final = body;
    return await store.update((current) => {
      const added = addRun(current, final);
      const withMessage = appendMessage(added.state, threadId, { role: "assistant", text: "", runId: added.runId }, clock().now);
      return { state: withMessage, result: added.runId };
    });
  } finally {
    release();
  }
}

export async function runExtract(store: Store, provider: AiProvider | null, providerNote: string, docId: string): Promise<string> {
  const release = guard(docId);
  try {
    const { now } = clock();
    const state: HealthState = store.get();
    const doc = state.imports.find((d) => d.id === docId);
    if (doc === undefined) throw new Error(`Document ${docId} is not in the record.`);
    const request = buildExtractRequest(state, doc, now);
    const started = Date.now();
    const base = { job: "EXTRACT" as const, subjectId: docId, recordRevision: state.revision, provider: provider?.name ?? "none", startedAt: now, floor: null };
    let body: RunBody;
    if (provider === null) {
      body = { ...base, model: config.ai.model, status: "FAILED", reasons: [providerNote], warnings: [], output: null, usage: NO_USAGE, durationMs: 0 };
    } else {
      const result = await provider.call({ system: request.system, context: request.context, messages: request.messages, schema: request.schema, job: "extract" });
      const durationMs = Date.now() - started;
      if (!result.ok) {
        body = { ...base, model: result.model, status: "FAILED", reasons: [result.error], warnings: [], output: null, usage: result.usage, durationMs };
      } else {
        const checked = validateExtract(result.output, doc, state);
        body = { ...base, model: result.model, status: checked.status as AiStatus, reasons: checked.reasons, warnings: checked.warnings, output: checked.output, usage: result.usage, durationMs };
      }
    }
    return await store.update((current) => {
      const added = addRun(current, body);
      return { state: added.state, result: added.runId };
    });
  } finally {
    release();
  }
}

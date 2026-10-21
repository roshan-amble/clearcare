import { takeId } from "../commands.js";
import { invalid, notFound } from "../errors.js";
import { PREFIX, type AiRun, type HealthState, type ImportDoc, type LocalDateTime, type Role, type Thread } from "../types.js";

/**
 * Chats, pasted documents and AI runs are kept in the record file but are not health data: adding them does not move
 * the record revision, so an answer stays "current" until the health data itself changes.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const titleOf = (text: string): string => {
  const first = text.trim().split(/\n/)[0] ?? "";
  return first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first;
};

export function startThread(state: HealthState, text: string, now: LocalDateTime): { readonly state: HealthState; readonly threadId: string } {
  const draft: Mutable<HealthState> = { ...state };
  const threadId = takeId(draft, PREFIX.thread);
  const thread: Thread = { id: threadId, title: titleOf(text) || "New chat", createdAt: now, messages: [] };
  draft.threads = [...state.threads, thread];
  return { state: draft, threadId };
}

export function appendMessage(
  state: HealthState,
  threadId: string,
  message: { readonly role: "user" | "assistant"; readonly text: string; readonly runId: string | null; readonly by?: string; readonly byRole?: Role },
  now: LocalDateTime,
): HealthState {
  const thread = state.threads.find((t) => t.id === threadId);
  if (thread === undefined) throw notFound(`Chat ${threadId} is not in the record.`);
  if (message.role === "user" && message.text.trim() === "") throw invalid("The message is empty.");
  if (message.text.length > 8000) throw invalid("The message is longer than 8,000 characters.");
  const draft: Mutable<HealthState> = { ...state };
  const id = takeId(draft, PREFIX.message);
  const who = message.by === undefined ? {} : { by: message.by, ...(message.byRole === undefined ? {} : { byRole: message.byRole }) };
  draft.threads = state.threads.map((t) =>
    t.id === threadId ? { ...t, messages: [...t.messages, { id, role: message.role, at: now, text: message.text.trim(), runId: message.runId, ...who }] } : t,
  );
  return draft;
}

export function addImportDoc(state: HealthState, input: { readonly label: string; readonly date: string | null; readonly text: string }, now: LocalDateTime) {
  const draft: Mutable<HealthState> = { ...state };
  const id = takeId(draft, PREFIX.importDoc);
  const doc: ImportDoc = { id, label: input.label, date: input.date, text: input.text, createdAt: now, runIds: [] };
  draft.imports = [...state.imports, doc];
  return { state: draft as HealthState, docId: id };
}

export function addRun(state: HealthState, run: Omit<AiRun, "id" | "decisions">): { readonly state: HealthState; readonly runId: string } {
  const draft: Mutable<HealthState> = { ...state };
  const runId = takeId(draft, PREFIX.aiRun);
  draft.aiRuns = [...state.aiRuns, { ...run, id: runId, decisions: [] }];
  if (run.job === "EXTRACT") {
    draft.imports = state.imports.map((d) => (d.id === run.subjectId ? { ...d, runIds: [...d.runIds, runId] } : d));
  }
  return { state: draft, runId };
}

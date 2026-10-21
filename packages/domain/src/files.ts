import { takeId } from "./commands.js";
import { invalid, notFound } from "./errors.js";
import { PREFIX, type FileRead, type HealthState, type LocalDateTime, type StoredFile } from "./types.js";

/**
 * Uploaded documents: the bytes live in data/documents on this computer; the record keeps their names. Like chats,
 * they are not health data the model reads, so adding one does not move the record revision.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const FILE_LIMIT_BYTES = 50 * 1024 * 1024;

/** A file name safe to show and to store: no folders, no control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "").trim().slice(0, 150);
  return cleaned === "" ? "document" : cleaned;
}

export function addFile(state: HealthState, input: { readonly name: string; readonly type: string; readonly size: number; readonly by?: string }, now: LocalDateTime) {
  if (input.size <= 0) throw invalid("The file is empty.");
  if (input.size > FILE_LIMIT_BYTES) throw invalid("Files can be at most 50 MB.");
  const draft: Mutable<HealthState> = { ...state };
  const id = takeId(draft, PREFIX.file);
  const name = cleanFileName(input.name);
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  const file: StoredFile = {
    id,
    name,
    type: input.type.slice(0, 100) || "application/octet-stream",
    size: input.size,
    stored: ext === undefined ? id : `${id}.${ext}`,
    uploadedAt: now,
    ...(input.by === undefined ? {} : { by: input.by }),
  };
  draft.files = [...state.files, file];
  return { state: draft as HealthState, file };
}

export function removeFile(state: HealthState, id: string): { readonly state: HealthState; readonly file: StoredFile } {
  const file = state.files.find((f) => f.id === id);
  if (file === undefined) throw notFound(`Document ${id} is not in the record.`);
  // Results and visits that pointed at the document keep everything else.
  const results = state.results.map((r) => (r.fileIds?.includes(id) === true ? { ...r, fileIds: r.fileIds.filter((x) => x !== id) } : r));
  const appointments = state.appointments.map((a) => (a.fileIds?.includes(id) === true ? { ...a, fileIds: a.fileIds.filter((x) => x !== id) } : a));
  return { state: { ...state, files: state.files.filter((f) => f.id !== id), results, appointments }, file };
}

/** Records what code found when it read a file. Like adding one, this does not move the record revision. */
export function setFileRead(state: HealthState, id: string, read: FileRead): HealthState {
  if (!state.files.some((f) => f.id === id)) return state;
  return { ...state, files: state.files.map((f) => (f.id === id ? { ...f, read } : f)) };
}

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { docFromPages, docFromText, fileReadOf, readCcda, type DocText, type FileRead, type LocalDateTime, type StoredFile } from "@clearcare/domain";

/**
 * Reads uploaded documents into text, once, on this Mac: health-record XML by domain code, PDFs and pictures by a
 * small Swift program using macOS's PDF reader and text recognition, Word and RTF files with textutil. Nothing is
 * sent anywhere to read them. The text is kept next to each file as FILE-n.read.json; the record keeps a summary.
 */

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../native/doctext.swift");
const BINARY = path.resolve(here, "../native/.build/doctext");
const MAX_CHARS = 3_000_000;

const IMAGE = /\.(png|jpe?g|heic|heif|gif|webp|tiff?|bmp)$/i;
const TEXTUTIL = /\.(docx?|rtf|rtfd|odt|wordml|webarchive)$/i;
const PLAIN = /\.(txt|md|csv|tsv|json|html?|xml)$/i;

let building: Promise<string> | null = null;

/** The compiled reader, built from its source the first time it is needed or after the source changes. */
function reader(): Promise<string> {
  const fresh = existsSync(BINARY) && statSync(BINARY).mtimeMs >= statSync(SOURCE).mtimeMs;
  if (fresh) return Promise.resolve(BINARY);
  building ??= (async () => {
    await mkdir(path.dirname(BINARY), { recursive: true });
    await run("/usr/bin/swiftc", ["-O", "-o", BINARY, SOURCE], { timeout: 300_000 });
    return BINARY;
  })().finally(() => {
    building = null;
  });
  return building;
}

export interface ReadOutcome {
  readonly doc: DocText | null;
  readonly read: FileRead;
}

export class DocumentReader {
  private readonly cache = new Map<string, { mtime: number; doc: DocText | null }>();

  constructor(private readonly dir: string) {}

  private sidecar(id: string): string {
    return path.join(this.dir, `${id}.read.json`);
  }

  /** Reads one uploaded file and keeps its text. Never throws: a failure is reported in the outcome. */
  async read(file: StoredFile, now: LocalDateTime): Promise<ReadOutcome> {
    const full = path.join(this.dir, file.stored);
    let doc: DocText | null = null;
    try {
      const name = file.name;
      if (/\.pdf$/i.test(name) || file.type === "application/pdf" || IMAGE.test(name) || file.type.startsWith("image/")) {
        // The reader picks PDF or picture by the extension, so name the stored file by what it is.
        const { stdout } = await run(await reader(), [full], { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
        const out = JSON.parse(stdout) as { method: "PDF" | "OCR"; pages: string[] };
        doc = docFromPages(out.pages, out.method, name);
      } else if (TEXTUTIL.test(name)) {
        const { stdout } = await run("/usr/bin/textutil", ["-convert", "txt", "-stdout", full], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
        doc = docFromText(stdout.slice(0, MAX_CHARS), name);
      } else if (PLAIN.test(name) || file.type.startsWith("text/") || file.type.includes("xml") || file.type.includes("json")) {
        const raw = (await readFile(full, "utf8")).slice(0, 40_000_000);
        if (raw.includes("<ClinicalDocument")) doc = readCcda(raw);
        else if (raw.includes("SubmitObjectsRequest")) {
          return this.keep(file, null, fileReadOf(null, now, { status: "UNSUPPORTED", note: "This is the export's list of files, not a health document." }));
        } else doc = docFromText(raw.slice(0, MAX_CHARS), name);
      } else {
        return this.keep(file, null, fileReadOf(null, now, { status: "UNSUPPORTED", note: "ClearCare can't read this kind of file yet." }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n").find((l) => l.trim() !== "") ?? "" : String(error);
      return this.keep(file, null, fileReadOf(null, now, { status: "FAILED", note: `It could not be read: ${message.slice(0, 200)}` }));
    }
    return this.keep(file, doc, fileReadOf(doc, now));
  }

  private async keep(file: StoredFile, doc: DocText | null, read: FileRead): Promise<ReadOutcome> {
    if (doc !== null) await writeFile(this.sidecar(file.id), JSON.stringify(doc), { mode: 0o600 });
    else await rm(this.sidecar(file.id), { force: true });
    this.cache.delete(file.id);
    return { doc, read };
  }

  /** The text of a file read earlier, or null. */
  text(file: StoredFile): DocText | null {
    const p = this.sidecar(file.id);
    if (!existsSync(p)) return null;
    const mtime = statSync(p).mtimeMs;
    const hit = this.cache.get(file.id);
    if (hit !== undefined && hit.mtime === mtime) return hit.doc;
    let doc: DocText | null = null;
    try {
      doc = JSON.parse(readFileSync(p, "utf8")) as DocText;
    } catch {
      doc = null;
    }
    this.cache.set(file.id, { mtime, doc });
    return doc;
  }

  /** Every readable file's text, for the AI. */
  library(files: readonly StoredFile[]): Map<string, DocText> {
    const out = new Map<string, DocText>();
    for (const f of files) {
      const doc = this.text(f);
      if (doc !== null) out.set(f.id, doc);
    }
    return out;
  }

  async remove(file: StoredFile): Promise<void> {
    this.cache.delete(file.id);
    await rm(this.sidecar(file.id), { force: true });
  }
}

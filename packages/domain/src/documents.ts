import type { FileRead, LocalDate, LocalDateTime, StoredFile } from "./types.js";

/**
 * Uploaded documents as text, read by code so the model can read them too. A health-record export (C-CDA XML, the
 * "Summary of Care" files a patient portal downloads) is turned into its sections; a PDF or a picture arrives here
 * as the text of each page, read on the Mac. The text lives next to the file in data/documents, never in the record,
 * so the app stays small; the record keeps only what was found (FileRead).
 */

export interface DocSection {
  readonly title: string;
  readonly text: string;
}

export interface DocVisit {
  /** Office Visit, Hospital Encounter, Emergency. */
  readonly type: string;
  readonly doctor: string;
  readonly specialty: string;
  /** The department or clinic. */
  readonly location: string;
  /** The health system. */
  readonly organization: string;
}

export interface DocText {
  readonly method: NonNullable<FileRead["method"]>;
  readonly title: string;
  readonly date: LocalDate | null;
  /** When the visit started, for a visit summary. */
  readonly at: LocalDateTime | null;
  readonly visit: DocVisit | null;
  readonly pages: number | null;
  readonly sections: readonly DocSection[];
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const tidy = (s: string): string =>
  s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");

/** One table cell or list item on one line: its paragraphs joined with "; ". */
function inline(x: string): string {
  return x
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<\/(paragraph|item)>\s*<(paragraph|item)\b[^>]*>/gi, "; ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\s*;\s*)+/g, "; ")
    .replace(/^[;\s]+|[;\s]+$/g, "");
}

/** The human-readable part of a C-CDA section (its <text>), as plain text: one table row per line, cells split by |. */
export function narrativeToText(xml: string): string {
  let t = xml.replace(/<t([dh])\b[^>]*\/>/gi, " | ").replace(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi, (_w, _k, inner: string) => `${inline(inner)} | `);
  t = t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<item\b[^>]*>/gi, "\n- ")
    .replace(/<(paragraph|caption)\b[^>]*>/gi, "\n")
    .replace(/<\/(paragraph|item|caption|tr|list|table|thead|tbody|tfoot)>/gi, "\n")
    .replace(/<\/(content|linkHtml|footnote)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  const lines = tidy(
    decodeEntities(t)
      .split("\n")
      .map((line) => line.replace(/(\s*\|\s*)+$/, "").replace(/^(\s*\|\s*)+/, "").replace(/(\s*\|\s*){2,}/g, " | "))
      .join("\n"),
  ).split("\n");
  // A list item whose text starts on the next line.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "-" && i + 1 < lines.length) out.push(`- ${lines[++i]}`);
    else out.push(lines[i]!);
  }
  return out.join("\n");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): LocalDate | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : `${y}-${pad(m)}-${pad(d)}`;
}

/** A date written in a file name: "Mammogram - Mar 3, 2025.pdf", "labs 2025-03-03.pdf". */
export function dateInName(name: string): LocalDate | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (iso !== null) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(name);
  if (named !== null) return validDate(Number(named[3]), MONTHS.indexOf(named[1]!.toLowerCase()) + 1, Number(named[2]));
  return null;
}

/** "20251104104500-0700" to a date and, when present, a time. */
function hl7Time(value: string | undefined): { date: LocalDate | null; at: LocalDateTime | null } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?/.exec(value ?? "");
  if (m === null) return { date: null, at: null };
  const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (date === null) return { date: null, at: null };
  return { date, at: m[4] === undefined ? null : `${date}T${m[4]}:${m[5]}` };
}

const textOf = (x: string | undefined): string => (x === undefined ? "" : decodeEntities(x.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------------------------------------------------------
// Readers

/** A C-CDA document (the XML a patient portal exports), or null when the XML is something else. */
export function readCcda(xml: string): DocText | null {
  const root = xml.indexOf("<ClinicalDocument");
  if (root < 0) return null;
  const body = xml.indexOf("<component>", root);
  const header = xml.slice(root, body < 0 ? undefined : body);
  const title = textOf(/<title>([\s\S]*?)<\/title>/.exec(header)?.[1]) || "Health record document";

  let visit: DocVisit | null = null;
  let time = hl7Time(/<effectiveTime value="(\d+)/.exec(header)?.[1]);
  const encounter = /<encompassingEncounter>([\s\S]*?)<\/encompassingEncounter>/.exec(header)?.[1];
  if (encounter !== undefined) {
    const start = hl7Time(/<effectiveTime\b[^>]*>\s*<low value="(\d+)/.exec(encounter)?.[1] ?? /<effectiveTime value="(\d+)/.exec(encounter)?.[1]);
    if (start.date !== null) time = start;
    const code = /<code\b[\s\S]*?(?:<\/code>|\/>)/.exec(encounter)?.[0] ?? "";
    const participant = /<encounterParticipant typeCode="ATND"[\s\S]*?<\/encounterParticipant>/.exec(encounter)?.[0] ?? /<encounterParticipant[\s\S]*?<\/encounterParticipant>/.exec(encounter)?.[0] ?? encounter;
    visit = {
      type: textOf(/<originalText>([\s\S]*?)<\/originalText>/.exec(code)?.[1]) || (/displayName="([^"]*)"/.exec(code)?.[1] ?? ""),
      doctor: textOf(/<assignedPerson>\s*<name\b[^>]*>([\s\S]*?)<\/name>/.exec(participant)?.[1]),
      specialty: decodeEntities(/<translation\b[^>]*displayName="([^"]*)"/.exec(participant)?.[1] ?? /<code\b[^>]*displayName="([^"]*)"/.exec(participant)?.[1] ?? ""),
      location: textOf(/<location>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(encounter)?.[1]),
      organization: textOf(/<representedOrganization>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(encounter)?.[1]),
    };
  }

  // Each section's narrative: the first <text> after its <title>, before any nested section starts.
  const sections: DocSection[] = [];
  const starts = [...xml.matchAll(/<section\b[^>]*>/g)].map((m) => m.index!);
  for (const [i, at] of starts.entries()) {
    const end = Math.min(...[starts[i + 1] ?? xml.length, xml.indexOf("</section>", at)].filter((n) => n >= 0));
    const chunk = xml.slice(at, end);
    const sectionTitle = textOf(/<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1]);
    const narrative = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(chunk)?.[1];
    if (narrative === undefined) continue;
    const text = narrativeToText(narrative);
    if (text !== "") sections.push({ title: sectionTitle || "Section", text });
  }
  return { method: "CCDA", title, date: time.date, at: time.at, visit, pages: null, sections };
}

const stem = (name: string): string => name.replace(/\.[a-z0-9]{1,8}$/i, "");

/** A PDF's or a picture's text, one section per page. */
export function docFromPages(pages: readonly string[], method: "PDF" | "OCR", fileName: string): DocText {
  const sections = pages.map((text, i) => ({ title: pages.length === 1 ? "Text" : `Page ${i + 1}`, text: tidy(text) })).filter((s) => s.text !== "");
  return { method, title: stem(fileName), date: dateInName(fileName), at: null, visit: null, pages: pages.length, sections };
}

/** A plain-text file, or markup with its tags removed. */
export function docFromText(raw: string, fileName: string): DocText {
  const text = /<\/?[a-z][\s\S]*?>/i.test(raw) ? decodeEntities(raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")) : raw;
  const clean = tidy(text);
  return { method: "TEXT", title: stem(fileName), date: dateInName(fileName), at: null, visit: null, pages: null, sections: clean === "" ? [] : [{ title: "Text", text: clean }] };
}

export const docChars = (doc: DocText): number => doc.sections.reduce((n, s) => n + s.text.length, 0);

/** "Office Visit · Ada B Sample, Family Medicine · Sample Clinic". */
export function visitLine(doc: Pick<DocText, "visit">): string {
  const v = doc.visit;
  if (v === null) return "";
  const who = [v.doctor, v.specialty].filter((x) => x !== "").join(", ");
  return [v.type, who, v.location || v.organization].filter((x) => x !== "").join(" · ");
}

export function fileReadOf(doc: DocText | null, now: LocalDateTime, failure: { status: "FAILED" | "UNSUPPORTED"; note: string } | null = null): FileRead {
  if (doc === null) {
    return { status: failure?.status ?? "FAILED", method: null, title: "", date: null, summary: "", chars: 0, pages: null, note: failure?.note ?? "", readAt: now };
  }
  const chars = docChars(doc);
  return {
    status: chars === 0 ? "EMPTY" : "READ",
    method: doc.method,
    title: doc.title,
    date: doc.date,
    summary: visitLine(doc),
    chars,
    pages: doc.pages,
    note: chars === 0 ? "No text was found in it." : "",
    readAt: now,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing what the model reads. Every document is listed; the text of the ones that matter is included in full,
// within a budget, and the model can ask for more by ID (the server then sends them and asks again).

export type DocLibrary = ReadonlyMap<string, DocText>;

export interface DocEntry {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly date: LocalDate | null;
  readonly at: LocalDateTime | null;
  readonly visit: string;
  readonly reasonForVisit: string;
  readonly diagnoses: string;
  readonly sections: readonly string[];
  readonly chars: number;
  /** FULL: every section is below; PART: some sections are; NONE: only this listing. UNREADABLE: no text. */
  readonly textSent: "FULL" | "PART" | "NONE" | "UNREADABLE";
  readonly text?: string;
}

export interface DocPacket {
  readonly documents: readonly DocEntry[];
  /** Documents whose whole text was sent. */
  readonly fullIds: ReadonlySet<string>;
  readonly charsSent: number;
}

export interface DocChoice {
  /** The person's recent words, to find the documents they mean. */
  readonly query: string;
  /** IDs the model asked to read, sent first and in full when they fit. */
  readonly include?: readonly string[];
  /** Characters of document text to send at most. */
  readonly budget: number;
  /** Documents this short are always sent whole, while the budget lasts. */
  readonly smallDoc?: number;
}

const STOP = new Set(
  "about above after again also among and any are been before being below between both but can could did does doing done down during each few for from further had has have having her here hers herself him his how into its itself just more most much must need not now off once only other our out over own same she should some such than that the their them then there these they this those through too under until upon very was were what when where which while who whom why will with would you your yours make create take all relevant documents document uploaded upload segments appropriate existing incomplete please mom mother can't don't she's".split(
    " ",
  ),
);

export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/);
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d{1,2}$/.test(w)))];
}

const MONTH_THEN_YEAR =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})\b/g;

/** Months ("March 2026") and dates ("Nov 4, 2025", "11/04/2025", "2025-11-04") the person names. */
export function datesInQuery(query: string): { readonly days: Set<LocalDate>; readonly months: Set<string> } {
  const days = new Set<LocalDate>();
  const months = new Set<string>();
  const q = query.toLowerCase();
  for (const m of q.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d !== null) days.add(d);
  }
  for (const m of q.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const d = validDate(Number(m[3]), Number(m[1]), Number(m[2]));
    if (d !== null) days.add(d);
  }
  for (const m of q.matchAll(MONTH_THEN_YEAR)) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3)) + 1;
    if (m[2] !== undefined) {
      const d = validDate(Number(m[3]), month, Number(m[2]));
      if (d !== null) days.add(d);
    } else months.add(`${m[3]}-${pad(month)}`);
  }
  return { days, months };
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Lists every uploaded document and adds text for the ones that matter: the ones the model asked for, the ones the
 * person names (by ID, by a date, or by a word that appears in only a few documents' doctor, place or title), short
 * documents, then the sections that best match the person's words. A section that repeats one already sent is
 * replaced by a pointer to it.
 */
export function chooseDocuments(files: readonly StoredFile[], library: DocLibrary, choice: DocChoice): DocPacket {
  const smallDoc = choice.smallDoc ?? 6000;
  const readable = files.filter((f) => (library.get(f.id)?.sections.length ?? 0) > 0);
  const terms = queryTerms(choice.query);
  const { days, months } = datesInQuery(choice.query);
  const sent = new Map<string, DocSection[]>();
  const sentSections = new Set<string>();
  const firstSeen = new Map<string, string>();
  let used = 0;

  const addSection = (id: string, section: DocSection, force = false): boolean => {
    const key = `${id}\u0000${section.title}\u0000${section.text.length}`;
    if (sentSections.has(key)) return true;
    const norm = normalize(section.text);
    const seenIn = firstSeen.get(norm);
    const text = seenIn !== undefined && seenIn !== id ? `(Same as the "${section.title}" section of ${seenIn}.)` : section.text;
    if (!force && used + text.length > choice.budget) return false;
    if (seenIn === undefined) firstSeen.set(norm, id);
    sentSections.add(key);
    used += text.length;
    sent.set(id, [...(sent.get(id) ?? []), { title: section.title, text }]);
    return true;
  };
  const addWhole = (id: string): void => {
    const doc = library.get(id);
    if (doc === undefined) return;
    for (const section of doc.sections) if (!addSection(id, section)) return;
  };

  // 1. What the model asked for, then what the person named.
  for (const id of choice.include ?? []) addWhole(id);
  const lowerQuery = choice.query.toLowerCase();
  const named = readable.filter((f) => {
    const doc = library.get(f.id)!;
    if (lowerQuery.includes(f.id.toLowerCase())) return true;
    if (doc.date !== null && (days.has(doc.date) || months.has(doc.date.slice(0, 7)))) return true;
    return false;
  });
  // A word names a document when it appears in the doctor, place, type or title of only a few of them (at most a
  // third, and at most three).
  const label = (f: StoredFile) => {
    const doc = library.get(f.id)!;
    return `${f.name} ${doc.title} ${visitLine(doc)} ${doc.visit?.organization ?? ""}`.toLowerCase();
  };
  const rare = Math.max(1, Math.min(3, Math.floor(readable.length / 3)));
  for (const term of terms) {
    const hits = readable.filter((f) => label(f).includes(term));
    if (hits.length > 0 && hits.length <= rare) named.push(...hits);
  }
  for (const f of named) addWhole(f.id);

  // 2. Short documents (a scan report, a test result, a photo of a page).
  for (const f of readable) if (docChars(library.get(f.id)!) <= smallDoc) addWhole(f.id);

  // 3. The sections that best match the person's words, rarest words counting most.
  if (terms.length > 0) {
    const all = readable.flatMap((f) => library.get(f.id)!.sections.map((s) => ({ id: f.id, s, hay: `${s.title} ${s.title} ${s.title} ${s.text}`.toLowerCase() })));
    const df = new Map(terms.map((t) => [t, all.filter((x) => x.hay.includes(t)).length]));
    const scored = all
      .map((x) => {
        let score = 0;
        for (const t of terms) {
          const n = df.get(t)!;
          if (n === 0 || !x.hay.includes(t)) continue;
          const tf = Math.min(5, x.hay.split(t).length - 1);
          score += tf * Math.log(1 + all.length / n);
        }
        return { ...x, score: score / Math.sqrt(1 + x.s.text.length / 2000) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const x of scored) {
      if (used >= choice.budget) break;
      addSection(x.id, x.s);
    }
  }

  const fullIds = new Set<string>();
  const documents = files
    .slice()
    .sort((a, b) => (library.get(a.id)?.date ?? a.uploadedAt.slice(0, 10)).localeCompare(library.get(b.id)?.date ?? b.uploadedAt.slice(0, 10)))
    .map((f): DocEntry => {
      const doc = library.get(f.id);
      const sections = doc?.sections ?? [];
      const part = sent.get(f.id) ?? [];
      const full = sections.length > 0 && part.length === sections.length;
      if (full) fullIds.add(f.id);
      const find = (re: RegExp) => sections.find((s) => re.test(s.title))?.text.replace(/\s+/g, " ").slice(0, 300) ?? "";
      return {
        id: f.id,
        name: f.name,
        title: doc?.title ?? f.name,
        date: doc?.date ?? null,
        at: doc?.at ?? null,
        visit: doc === undefined ? "" : visitLine(doc),
        reasonForVisit: find(/^reason for (visit|referral)/i),
        diagnoses: find(/diagnos/i),
        sections: sections.map((s) => s.title),
        chars: doc === undefined ? 0 : docChars(doc),
        textSent: sections.length === 0 ? "UNREADABLE" : full ? "FULL" : part.length > 0 ? "PART" : "NONE",
        ...(part.length === 0 ? {} : { text: part.map((s) => `## ${s.title}\n${s.text}`).join("\n\n") }),
      };
    });
  return { documents, fullIds, charsSent: used };
}

import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands.js";
import { addFile, removeFile, setFileRead } from "./files.js";
import {
  chooseDocuments,
  dateInName,
  datesInQuery,
  docFromPages,
  docFromText,
  fileReadOf,
  narrativeToText,
  readCcda,
  visitLine,
  type DocText,
} from "./documents.js";
import { buildChatRequest, validateChat } from "./ai/chat.js";
import { changeToCommands } from "./ai/changes.js";
import { applyAll } from "./commands.js";
import { sampleState } from "./sample.js";
import { startThread, appendMessage } from "./ai/runs.js";
import { summarizeTest } from "./results.js";
import type { HealthState } from "./types.js";

const NOW = "2026-10-20T10:00";
const TODAY = "2026-10-20";

/** A fictional visit summary in the shape a patient portal exports. */
const CCDA = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"><title>Summary of Care</title>
<effectiveTime value="20261020132057-0700" />
<componentOf><encompassingEncounter><id root="1" />
<code code="99214" displayName="PR LEVEL 4"><originalText>Office Visit</originalText><translation code="AMB" displayName="Ambulatory" /></code>
<effectiveTime><low value="20251104104500-0700" /></effectiveTime>
<responsibleParty><assignedEntity><representedOrganization><name>Sample Health System</name></representedOrganization></assignedEntity></responsibleParty>
<encounterParticipant typeCode="ATND"><assignedEntity><code code="207Q" displayName="Physician Family Medicine"><translation code="19" displayName="Family Medicine" /></code>
<assignedPerson><name><given>Ada</given><given>B</given><family>Sample</family></name></assignedPerson></assignedEntity></encounterParticipant>
<location><healthCareFacility><location><name>Sample Clinic &amp; Annex</name></location></healthCareFacility></location>
</encompassingEncounter></componentOf>
<component><structuredBody>
<component><section><title>Reason for Visit</title><text><list><item><paragraph>Reason</paragraph><paragraph>right wrist pain</paragraph></item></list></text></section></component>
<component><section><title>Results</title><text><table><thead><tr><th>Test</th><th>Value</th></tr></thead><tbody><tr><td>Hemoglobin A1C</td><td><paragraph>6.1 %</paragraph><paragraph>(H)</paragraph></td></tr></tbody></table></text>
<entry><observation><text><reference value="#r1" /></text></observation></entry></section></component>
<component><section><title>Allergies</title><text><content>No Known</content><content>Allergies</content></text></section></component>
<component><section><title>Plan of Treatment</title><text /></section></component>
</structuredBody></component></ClinicalDocument>`;

describe("reading documents", () => {
  it("turns a narrative block into lines: rows split by |, list items with dashes, entities decoded", () => {
    expect(narrativeToText(`<list><item><paragraph>Reason</paragraph><paragraph>knee</paragraph></item></list><table><tr><td>A &amp; B</td><td/><td>x</td></tr></table>`)).toBe(
      "- Reason\nknee\nA & B | x",
    );
  });

  it("reads a C-CDA visit summary: the visit, the doctor, the place, and each section with text", () => {
    const doc = readCcda(CCDA)!;
    expect(doc.title).toBe("Summary of Care");
    expect(doc.date).toBe("2025-11-04");
    expect(doc.at).toBe("2025-11-04T10:45");
    expect(doc.visit).toEqual({ type: "Office Visit", doctor: "Ada B Sample", specialty: "Family Medicine", location: "Sample Clinic & Annex", organization: "Sample Health System" });
    expect(visitLine(doc)).toBe("Office Visit · Ada B Sample, Family Medicine · Sample Clinic & Annex");
    expect(doc.sections.map((s) => s.title)).toEqual(["Reason for Visit", "Results", "Allergies"]);
    expect(doc.sections[1]!.text).toBe("Test | Value\nHemoglobin A1C | 6.1 %; (H)");
    expect(doc.sections[2]!.text).toBe("No Known Allergies");
    expect(readCcda("<SubmitObjectsRequest/>")).toBeNull();
  });

  it("reads pages and plain text, and finds a date in a file name", () => {
    const doc = docFromPages(["IMPRESSION: Normal.", "  "], "PDF", "Scan - Screening Mammogram - Mar 3, 2025.PDF");
    expect(doc.title).toBe("Scan - Screening Mammogram - Mar 3, 2025");
    expect(doc.date).toBe("2025-03-03");
    expect(doc.sections).toEqual([{ title: "Page 1", text: "IMPRESSION: Normal." }]);
    expect(docFromText("<p>Hello <b>there</b></p><p>Line 2</p>", "note.html").sections[0]!.text).toBe("Hello there\nLine 2");
    expect(dateInName("labs 2025-02-30.pdf")).toBeNull();
    expect(fileReadOf(docFromPages([""], "OCR", "photo.png"), NOW).status).toBe("EMPTY");
    expect(fileReadOf(null, NOW, { status: "UNSUPPORTED", note: "x" })).toMatchObject({ status: "UNSUPPORTED", chars: 0 });
  });

  it("finds the months and days a person names", () => {
    const { days, months } = datesInQuery("what happened in March 2026, on Nov 4, 2025, 11/04/2025 and 2024-02-29?");
    expect([...months]).toEqual(["2026-03"]);
    expect([...days].sort()).toEqual(["2024-02-29", "2025-11-04"]);
  });
});

/** A record with three fictional uploads: two visits and one short scan report. */
function library(): { state: HealthState; lib: Map<string, DocText> } {
  let state = sampleState(NOW);
  const lib = new Map<string, DocText>();
  const add = (name: string, doc: DocText) => {
    const added = addFile(state, { name, type: "text/xml", size: 100 }, NOW);
    state = setFileRead(added.state, added.file.id, fileReadOf(doc, NOW));
    lib.set(added.file.id, doc);
    return added.file.id;
  };
  const boiler = { title: "Note from Sample Health System", text: "This summary is for your records. ".repeat(40) };
  const visit = (date: string, doctor: string, specialty: string, extra: string): DocText => ({
    method: "CCDA",
    title: "Summary of Care",
    date,
    at: `${date}T09:00`,
    visit: { type: "Office Visit", doctor, specialty, location: `${specialty} Clinic`, organization: "Sample Health System" },
    pages: null,
    sections: [boiler, { title: "Reason for Visit", text: extra }, { title: "Progress Notes", text: `${extra}. `.repeat(200) }],
  });
  add("DOC0001.XML", visit("2026-03-12", "Ada Sample", "Orthopedics", "knee pain when climbing stairs"));
  add("DOC0002.XML", visit("2025-11-04", "Bo Sample", "Family Medicine", "wrist sprain follow up"));
  add("Scan - MRI Lumbar Spine - Apr 2, 2026.pdf", docFromPages(["IMPRESSION: Mild disc bulge at L4-5."], "PDF", "Scan - MRI Lumbar Spine - Apr 2, 2026.pdf"));
  return { state, lib };
}

describe("choosing documents for the model", () => {
  it("lists every document, sends short ones whole, and names the visits a date or a rare word points at", () => {
    const { state, lib } = library();
    const ids = state.files.map((f) => f.id);
    const packet = chooseDocuments(state.files, lib, { query: "what did the orthopedics visit in March 2026 say?", budget: 20000 });
    expect(packet.documents.map((d) => d.id)).toEqual([ids[1], ids[0], ids[2]]); // oldest first
    expect(packet.fullIds.has(ids[0]!)).toBe(true); // March 2026, orthopedics
    expect(packet.fullIds.has(ids[2]!)).toBe(true); // short
    // The November visit was not named: at most a matching section of it goes along, never all of it.
    expect(packet.documents.find((d) => d.id === ids[1])!.textSent).not.toBe("FULL");
    const march = packet.documents.find((d) => d.id === ids[0])!;
    expect(march).toMatchObject({ visit: "Office Visit · Ada Sample, Orthopedics · Orthopedics Clinic", reasonForVisit: "knee pain when climbing stairs", date: "2026-03-12" });
  });

  it("sends a repeated section once and points to it after that", () => {
    const { state, lib } = library();
    const ids = state.files.map((f) => f.id);
    const packet = chooseDocuments(state.files, lib, { query: "", include: [ids[0]!, ids[1]!], budget: 100000 });
    const second = packet.documents.find((d) => d.id === ids[1])!;
    expect(second.textSent).toBe("FULL");
    expect(second.text).toContain(`(Same as the "Note from Sample Health System" section of ${ids[0]}.)`);
  });

  it("keeps to the budget, sending part of a document rather than going over", () => {
    const { state, lib } = library();
    const packet = chooseDocuments(state.files, lib, { query: "wrist sprain", budget: 3000 });
    expect(packet.charsSent).toBeLessThanOrEqual(3000);
    expect(packet.documents.some((d) => d.textSent === "PART")).toBe(true);
  });

  it("puts the documents in the chat request, lets the model quote them, and passes on what it asks to read", () => {
    const { state: base, lib } = library();
    const started = startThread(base, "What did her MRI show?", NOW);
    const state = appendMessage(started.state, started.threadId, { role: "user", text: "What did her MRI show?", runId: null }, NOW);
    const thread = state.threads.find((t) => t.id === started.threadId)!;
    const mri = state.files.at(-1)!.id;
    const visit = state.files[1]!.id;
    const request = buildChatRequest(state, thread, TODAY, NOW, lib);
    expect(request.context).toContain("Mild disc bulge at L4-5");
    expect(request.schema.required).toContain("readDocuments");
    const output = {
      urgency: "INFO",
      headline: "Her MRI showed a mild disc bulge.",
      answer: "It found a mild disc bulge in the lower back.",
      connections: [{ recordId: mri, quote: "Mild disc bulge at L4-5", likelihood: "LIKELY", explanation: "The report says so." }],
      otherPossibilities: [],
      followUpQuestions: [],
      proposals: [],
      readDocuments: [visit, "FILE-999", mri],
    };
    const checked = validateChat(output, request, state);
    expect(checked.status).toBe("SUCCEEDED");
    // Only uploads that exist and were not already sent whole.
    expect((checked.output as { readDocuments: string[] }).readDocuments).toEqual([visit]);
    expect(checked.warnings.join(" ")).toContain("FILE-999");
    const again = buildChatRequest(state, thread, TODAY, NOW, lib, [visit]);
    expect(again.documents!.fullIds.has(visit)).toBe(true);
    expect(again.messages.at(-1)!.content).toContain("documents_sent");
  });
});

describe("scan and biopsy reports", () => {
  const withMri = () => {
    let state = sampleState(NOW);
    const added = addFile(state, { name: "mri.pdf", type: "application/pdf", size: 10 }, NOW);
    state = added.state;
    state = applyCommand(state, { type: "save", collection: "test", data: { name: "MRI lumbar spine", kind: "IMAGING" } }, NOW).state;
    return { state, testId: state.tests.at(-1)!.id, fileId: added.file.id };
  };

  it("saves a report with only the month known, an impression, findings and its document", () => {
    const { state, testId, fileId } = withMri();
    const next = applyCommand(
      state,
      { type: "save", collection: "result", data: { testId, date: "2026-03", impression: "Mild disc bulge at L4-5.", findings: "L4-5: mild broad-based disc bulge without stenosis.", fileIds: [fileId] } },
      NOW,
    ).state;
    const r = next.results.at(-1)!;
    expect(r).toMatchObject({ date: "2026-03-01", datePrecision: "MONTH", value: "", impression: "Mild disc bulge at L4-5.", fileIds: [fileId] });
    const summary = summarizeTest(next, next.tests.find((t) => t.id === testId)!, TODAY);
    expect(summary.flag).toBeNull();
    // Deleting the document keeps the report and drops the link.
    expect(removeFile(next, fileId).state.results.at(-1)!.fileIds).toEqual([]);
  });

  it("refuses an empty report, a lab result without a value, and a document that was never uploaded", () => {
    const { state, testId } = withMri();
    expect(() => applyCommand(state, { type: "save", collection: "result", data: { testId, date: "2026-03-14" } }, NOW)).toThrow(/at least one/);
    expect(() => applyCommand(state, { type: "save", collection: "result", data: { testId, date: "2026-03", fileIds: ["FILE-99"] } }, NOW)).toThrow(/not an uploaded document/);
    const lab = state.tests.find((t) => t.kind === "LAB")!;
    expect(() => applyCommand(state, { type: "save", collection: "result", data: { testId: lab.id, date: "2026-03-14" } }, NOW)).toThrow(/Value/);
  });

  it("lets the chat add a report for a new scan, creating the test as a scan", () => {
    const { state, fileId } = withMri();
    const blank = { testId: null, testName: null, testKind: null, unit: null, refLow: null, refHigh: null, date: null, value: null, impression: null, findings: null, facility: null, providerId: null, fileIds: null, note: null };
    const change = { kind: "SAVE" as const, collection: "result" as const, id: null, summary: "Save the mammogram report", fields: { ...blank, testName: "Screening mammogram", testKind: "IMAGING", date: "2025-03-03", impression: "No suspicious findings.", value: "BI-RADS 1", fileIds: [fileId] } };
    const next = applyAll(state, changeToCommands(state, change), NOW).state;
    const t = next.tests.at(-1)!;
    expect(t).toMatchObject({ name: "Screening mammogram", kind: "IMAGING" });
    expect(next.results.at(-1)).toMatchObject({ testId: t.id, value: "BI-RADS 1", impression: "No suspicious findings.", fileIds: [fileId] });
  });

  it("links a past visit to its visit summary, and unlinks it when the document is deleted", () => {
    const { state, fileId } = withMri();
    const next = applyCommand(
      state,
      { type: "save", collection: "appointment", data: { title: "Orthopedics", start: "2026-03-25T09:30", status: "COMPLETED", outcome: "MRI reviewed.", fileIds: [fileId] } },
      NOW,
    ).state;
    expect(next.appointments.at(-1)!.fileIds).toEqual([fileId]);
    expect(removeFile(next, fileId).state.appointments.at(-1)!.fileIds).toEqual([]);
  });

  it("edits a saved report", () => {
    const { state, testId } = withMri();
    const saved = applyCommand(state, { type: "save", collection: "result", data: { testId, date: "2026-03", impression: "First." } }, NOW).state;
    const id = saved.results.at(-1)!.id;
    const edited = applyCommand(saved, { type: "save", collection: "result", id, data: { testId, date: "2026-04-02", impression: "Corrected." } }, NOW).state;
    expect(edited.results.find((r) => r.id === id)).toMatchObject({ date: "2026-04-02", impression: "Corrected." });
    expect(edited.results.find((r) => r.id === id)!.datePrecision).toBeUndefined();
  });
});

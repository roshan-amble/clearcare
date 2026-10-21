import { applyAll, findRecord, type Applied, type Command } from "../commands.js";
import { addDays, dateOf } from "../dates.js";
import { invalid, notFound } from "../errors.js";
import type { AiRun, HealthState, LocalDateTime, ProposalDecision } from "../types.js";
import { changeToCommands, pickCreated, resolveChange } from "./changes.js";
import { chatChanges, type ChatOutput } from "./chat.js";
import type { ExtractItem, ExtractOutput } from "./extract.js";

/**
 * A person accepts or dismisses one proposal of a valid run. Accepting runs the same tested commands as a person's
 * own edit, marked as coming from that AI run. The person may edit the proposal first; edits replace the proposed
 * fields and are checked like any input.
 */

export type Decision = "ACCEPT" | "DISMISS";

const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Commands for one extracted item. A RESULT for a test that is not tracked yet first creates the test. */
function extractCommands(state: HealthState, item: ExtractItem, edits: Record<string, unknown>, docDate: string | null, label: string, now: LocalDateTime): Command[] {
  const today = dateOf(now);
  switch (item.kind) {
    case "RESULT": {
      const testId =
        (edits["testId"] as string | undefined) ??
        item.matchesTestId ??
        state.tests.find((t) => sameName(t.name, (edits["testName"] as string | undefined) ?? item.testName))?.id ??
        null;
      const date = edits["date"] ?? item.date ?? docDate ?? today;
      const value = edits["value"] ?? item.value;
      const note = `From ${label}`;
      if (testId !== null) return [{ type: "save", collection: "result", data: { testId, date, value, note } }];
      // The new test's ID is the next TST number, which applyAll assigns in order.
      const nextTestId = `TST-${(state.counters["TST"] ?? 0) + 1}`;
      return [
        {
          type: "save",
          collection: "test",
          data: { name: edits["testName"] ?? item.testName, kind: "LAB", unit: edits["unit"] ?? item.unit, refLow: item.refLow, refHigh: item.refHigh },
        },
        { type: "save", collection: "result", data: { testId: nextTestId, date, value, note } },
      ];
    }
    case "MEDICATION": {
      const matchId = (edits["medicationId"] as string | undefined) ?? item.matchesMedicationId;
      const match = matchId === null ? undefined : state.medications.find((m) => m.id === matchId);
      const dose = edits["dose"] ?? item.dose;
      const instructions = edits["instructions"] ?? item.instructions;
      if (match === undefined) {
        if (item.change === "STOPPED") throw invalid("Pick the medication this stops.");
        return [{ type: "save", collection: "medication", data: { name: edits["name"] ?? item.name, dose, instructions, startDate: item.change === "NEW" ? docDate : null, notes: `From ${label}` } }];
      }
      if (item.change === "STOPPED") return [{ type: "status", collection: "medication", id: match.id, status: "STOPPED", note: `From ${label}`, at: docDate }];
      // "Continued" confirms the medication; different wording of the same instructions is not a change.
      if (item.change === "CONTINUED" && match.dose === dose && edits["instructions"] === undefined) return [];
      return [
        {
          type: "save",
          collection: "medication",
          id: match.id,
          data: { ...match, dose, instructions, status: match.status === "STOPPED" ? "ACTIVE" : match.status, changedOn: docDate },
        },
      ];
    }
    case "DIAGNOSIS": {
      const matchId = (edits["diagnosisId"] as string | undefined) ?? item.matchesDiagnosisId ?? state.diagnoses.find((d) => sameName(d.name, item.name))?.id ?? null;
      const status = edits["status"] ?? item.status;
      if (matchId === null) return [{ type: "save", collection: "diagnosis", data: { name: edits["name"] ?? item.name, status, diagnosedOn: docDate, notes: `From ${label}` } }];
      const match = state.diagnoses.find((d) => d.id === matchId);
      if (match === undefined) throw notFound(`Diagnosis ${matchId} is not in the record.`);
      return match.status === status ? [] : [{ type: "status", collection: "diagnosis", id: match.id, status: status as string, note: `From ${label}` }];
    }
    case "APPOINTMENT": {
      const start = edits["start"] ?? item.start;
      return [
        {
          type: "save",
          collection: "appointment",
          data: {
            title: edits["title"] ?? item.title,
            specialty: edits["specialty"] ?? item.specialty,
            start,
            bookBy: start === null && item.bookWithinDays !== null ? addDays(docDate ?? today, item.bookWithinDays) : null,
            prep: `From ${label}`,
          },
        },
      ];
    }
  }
}

export function decideProposal(state: HealthState, runId: string, index: number, decision: Decision, editsInput: unknown, now: LocalDateTime, by: string | null = null): Applied {
  const run = state.aiRuns.find((r) => r.id === runId);
  if (run === undefined) throw notFound(`AI run ${runId} is not in the record.`);
  if (run.status !== "SUCCEEDED") throw invalid("Only a valid AI answer can be accepted.");
  if (run.decisions.some((d) => d.index === index)) throw invalid("This suggestion was already decided.");
  const edits = obj(editsInput);

  let commands: Command[] = [];
  if (run.job === "CHAT") {
    const item = chatChanges(run.output as ChatOutput, dateOf(now))[index];
    if (item === undefined) throw notFound(`Suggestion ${index + 1} is not in this answer.`);
    if (decision === "ACCEPT" && !item.check.ok) throw invalid(`This change cannot be applied: ${item.check.reasons.join(" ")}`);
    if (decision === "ACCEPT") {
      const resolved = resolveChange(item.change, (n, refs) => {
        const earlier = run.decisions.find((d) => d.index === n - 1 && d.decision === "ACCEPTED");
        const id = earlier === undefined ? null : pickCreated(earlier.createdIds, refs);
        if (id === null) throw invalid(`Apply suggestion ${n} first: this one points at what it adds.`);
        return id;
      });
      commands = changeToCommands(state, resolved, edits);
    }
  } else {
    const output = run.output as ExtractOutput;
    const checked = output.items[index];
    if (checked === undefined) throw notFound(`Item ${index + 1} is not in this extraction.`);
    if (decision === "ACCEPT" && !checked.ok) throw invalid(`Code refused this item: ${checked.reasons.join(" ")}`);
    const doc = state.imports.find((d) => d.id === run.subjectId);
    if (decision === "ACCEPT") commands = extractCommands(state, checked.item, edits, doc?.date ?? output.documentDate, doc?.label ?? "an imported document", now);
  }

  const applied: Applied = commands.length === 0 ? { state, createdIds: [] } : applyAll(state, commands, now, { source: "AI", aiRunId: run.id, by });
  const updatedIds = [...new Set(commands.flatMap((c) => (c.type === "status" ? [c.id] : c.type === "save" && typeof c.id === "string" ? [c.id] : [])))];
  const record: ProposalDecision = { index, decision: decision === "ACCEPT" ? "ACCEPTED" : "DISMISSED", at: now, createdIds: applied.createdIds, updatedIds };
  const aiRuns: AiRun[] = applied.state.aiRuns.map((r) => (r.id === run.id ? { ...r, decisions: [...r.decisions, record] } : r));
  return { state: { ...applied.state, aiRuns }, createdIds: applied.createdIds };
}

import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, isDate, isDateTime } from "./dates.js";
import { compare, format, parseDecimal, subtract } from "./decimal.js";
import { applyCommand, type Command } from "./commands.js";
import { DomainError } from "./errors.js";
import { resultFlag, summarizeTest, testDue } from "./results.js";
import { emptyState, type HealthState } from "./types.js";

const NOW = "2026-10-18T09:00";
const apply = (state: HealthState, command: Command) => applyCommand(state, command, NOW).state;

describe("dates", () => {
  it("checks real calendar dates", () => {
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDateTime("2026-10-18T24:00")).toBe(false);
    expect(isDateTime("2026-10-18T23:59")).toBe(true);
  });
  it("adds months the way a clinic counts them", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-10-18", "2026-10-11")).toBe(-7);
  });
});

describe("decimal", () => {
  it("compares lab values exactly", () => {
    expect(compare(parseDecimal("5.70")!.value, parseDecimal("5.7")!.value)).toBe(0);
    expect(format(subtract(parseDecimal("7.4")!.value, parseDecimal("7.0")!.value))).toBe("0.4");
    expect(format(subtract(parseDecimal("0.3")!.value, parseDecimal("0.1")!.value))).toBe("0.2");
    expect(parseDecimal("Negative")).toBeNull();
    expect(parseDecimal("<0.01")!.comparator).toBe("<");
  });
});

describe("result flags", () => {
  it("flags against the range", () => {
    expect(resultFlag("7.4", "4.0", "5.6")).toBe("HIGH");
    expect(resultFlag("5.6", "4.0", "5.6")).toBe("NORMAL");
    expect(resultFlag("11.3", "12.0", "15.5")).toBe("LOW");
    expect(resultFlag("55", "60", null)).toBe("LOW");
    expect(resultFlag("Negative", "0", "1")).toBeNull();
    expect(resultFlag("7.4", null, null)).toBeNull();
  });
  it("flags a bound only when the bound decides it", () => {
    expect(resultFlag(">60", "60", null)).toBe("NORMAL");
    expect(resultFlag("<0.01", "0.4", "4.0")).toBe("LOW");
    expect(resultFlag("<5", "0.4", "4.0")).toBeNull();
    expect(resultFlag(">200", "0", "150")).toBe("HIGH");
  });
});

function withTest(frequency: { every: number; unit: "MONTH" | "WEEK" } | null): HealthState {
  return apply(emptyState(NOW), { type: "save", collection: "test", data: { name: "A1C", unit: "%", refLow: "4.0", refHigh: "5.6", frequency } });
}

describe("due dates", () => {
  it("is never done without a result, and overdue after the frequency", () => {
    let state = withTest({ every: 3, unit: "MONTH" });
    const test = state.tests[0]!;
    expect(testDue(test, state.results, "2026-10-18")!.state).toBe("NEVER_DONE");
    state = apply(state, { type: "save", collection: "result", data: { testId: test.id, date: "2026-06-20", value: "7.4" } });
    const due = testDue(test, state.results, "2026-10-18")!;
    expect(due).toMatchObject({ lastDate: "2026-06-20", nextDate: "2026-09-20", daysUntil: -28, state: "OVERDUE" });
    expect(testDue(test, state.results, "2026-09-10")!.state).toBe("DUE_SOON");
    expect(testDue(test, state.results, "2026-08-01")!.state).toBe("OK");
  });
  it("has no due date without a frequency or when paused", () => {
    const state = withTest(null);
    expect(testDue(state.tests[0]!, [], "2026-10-18")).toBeNull();
    const paused = apply(withTest({ every: 1, unit: "WEEK" }), { type: "status", collection: "test", id: "TST-1", status: "PAUSED" });
    expect(testDue(paused.tests[0]!, [], "2026-10-18")).toBeNull();
  });
  it("summarizes the latest result and its exact change", () => {
    let state = withTest({ every: 3, unit: "MONTH" });
    state = apply(state, { type: "save", collection: "result", data: { testId: "TST-1", date: "2026-03-01", value: "7.0" } });
    state = apply(state, { type: "save", collection: "result", data: { testId: "TST-1", date: "2026-06-20", value: "7.4" } });
    const s = summarizeTest(state, state.tests[0]!, "2026-10-18");
    expect(s.latest!.value).toBe("7.4");
    expect(s).toMatchObject({ flag: "HIGH", delta: "+0.4", direction: "UP" });
  });
});

describe("people and who did it", () => {
  it("keeps Tailscale logins lowercase and unique", () => {
    const state = apply(emptyState(NOW), { type: "people.save", people: [{ login: "Mom@Gmail.com", name: "Mom", role: "PATIENT" }] });
    expect(state.people).toEqual([{ login: "mom@gmail.com", name: "Mom", role: "PATIENT" }]);
    expect(() => apply(state, { type: "people.save", people: [{ login: "mom", name: "Mom", role: "PATIENT" }] })).toThrow(/not a Tailscale login/);
    expect(() =>
      apply(state, { type: "people.save", people: [{ login: "a@b.com", name: "A", role: "CAREGIVER" }, { login: "A@b.com", name: "B", role: "PATIENT" }] }),
    ).toThrow(/listed twice/);
  });
  it("records who logged a check-in or added a question", () => {
    let state = applyCommand(emptyState(NOW), { type: "save", collection: "checkIn", data: { note: "Tired" } }, NOW, { source: "PERSON", aiRunId: null, by: "Mom" }).state;
    state = applyCommand(state, { type: "save", collection: "question", data: { text: "Why?" } }, NOW, { source: "PERSON", aiRunId: null, by: "Sam" }).state;
    expect(state.checkIns[0]!.by).toBe("Mom");
    expect(state.questions[0]!.by).toBe("Sam");
    state = apply(state, { type: "save", collection: "checkIn", id: "CHK-1", data: { note: "Edited" } });
    expect(state.checkIns[0]!.by).toBe("Mom");
  });
});

describe("commands", () => {
  it("increments the revision and assigns readable IDs", () => {
    const state = apply(apply(emptyState(NOW), { type: "save", collection: "provider", data: { name: "Dr. A" } }), {
      type: "save",
      collection: "provider",
      data: { name: "Dr. B" },
    });
    expect(state.revision).toBe(2);
    expect(state.providers.map((p) => p.id)).toEqual(["PRV-1", "PRV-2"]);
  });
  it("refuses a scheduled appointment without a time, and an unknown doctor", () => {
    const state = emptyState(NOW);
    expect(() => apply(state, { type: "save", collection: "appointment", data: { title: "X", status: "SCHEDULED" } })).toThrow(/needs a date and time/);
    expect(() => apply(state, { type: "save", collection: "appointment", data: { title: "X", providerId: "PRV-9" } })).toThrow(DomainError);
  });
  it("defaults an appointment without a time to TO_BOOK", () => {
    const state = apply(emptyState(NOW), { type: "save", collection: "appointment", data: { title: "Eye exam", bookBy: "2026-11-01" } });
    expect(state.appointments[0]).toMatchObject({ status: "TO_BOOK", bookBy: "2026-11-01", source: "PERSON" });
  });
  it("records a dose change in the medication history on the date it took effect", () => {
    let state = apply(emptyState(NOW), { type: "save", collection: "medication", data: { name: "Metoprolol", dose: "25 mg", startDate: "2023-08-25" } });
    state = apply(state, { type: "save", collection: "medication", id: "MED-1", data: { ...state.medications[0], dose: "50 mg", changedOn: "2026-09-22" } });
    const history = state.medications[0]!.history;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ at: "2023-08-25T00:00", from: null, to: "ACTIVE" });
    expect(history[1]).toMatchObject({ at: "2026-09-22T00:00", from: "ACTIVE", to: "ACTIVE", note: "Changed dose 25 mg → 50 mg" });
  });
  it("keeps every status change with its note", () => {
    let state = apply(emptyState(NOW), { type: "save", collection: "diagnosis", data: { name: "Hypertension" } });
    state = apply(state, { type: "status", collection: "diagnosis", id: "DX-1", status: "MANAGED", note: "BP at goal", at: "2026-10-01" });
    expect(state.diagnoses[0]!.status).toBe("MANAGED");
    expect(state.diagnoses[0]!.history.at(-1)).toMatchObject({ at: "2026-10-01T00:00", from: "ACTIVE", to: "MANAGED", note: "BP at goal" });
  });
  it("refuses a check-in with nothing in it, and half a blood pressure", () => {
    expect(() => apply(emptyState(NOW), { type: "save", collection: "checkIn", data: {} })).toThrow(/at least one thing/);
    expect(() => apply(emptyState(NOW), { type: "save", collection: "checkIn", data: { bpSys: 120 } })).toThrow(/both numbers/);
  });
  it("removes references to a deleted record, and a test's results with it", () => {
    let state = apply(emptyState(NOW), { type: "save", collection: "diagnosis", data: { name: "Diabetes" } });
    state = apply(state, { type: "save", collection: "test", data: { name: "A1C", diagnosisIds: ["DX-1"] } });
    state = apply(state, { type: "save", collection: "result", data: { testId: "TST-1", date: "2026-10-01", value: "7.1" } });
    state = apply(state, { type: "save", collection: "question", data: { text: "Is 7.1 ok?", relatedIds: ["RES-1", "DX-1"] } });
    state = apply(state, { type: "delete", collection: "diagnosis", id: "DX-1" });
    expect(state.tests[0]!.diagnosisIds).toEqual([]);
    state = apply(state, { type: "delete", collection: "test", id: "TST-1" });
    expect(state.results).toEqual([]);
    expect(state.questions[0]!.relatedIds).toEqual([]);
  });
});

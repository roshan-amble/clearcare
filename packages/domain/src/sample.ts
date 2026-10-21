import { applyCommand, type Command } from "./commands.js";
import { addDays, dateOf } from "./dates.js";
import { emptyState, type HealthState, type LocalDateTime } from "./types.js";

/**
 * A fictional sample patient, built through the same commands a person uses, with dates relative to today. It shows
 * every feature: a recent dose change followed by tiredness, a low heart rate, an overdue test, a test never done,
 * a refill due, a visit to book, and a red flag in yesterday's check-in. Every name in it is invented.
 */
export function sampleState(now: LocalDateTime): HealthState {
  const today = dateOf(now);
  const year = Number(today.slice(0, 4));
  const d = (days: number) => addDays(today, days);
  const at = (days: number, time: string) => `${d(days)}T${time}`;
  let state = emptyState(now);
  const run = (command: Command) => {
    state = applyCommand(state, command, now).state;
  };
  const save = (collection: Extract<Command, { type: "save" }>["collection"], data: Record<string, unknown>, id?: string) =>
    run({ type: "save", collection, data, ...(id === undefined ? {} : { id }) });

  run({
    type: "profile.save",
    profile: {
      name: "Sample patient",
      birthYear: year - 76,
      sex: "FEMALE",
      allergies: ["Penicillin (hives)"],
      emergencyContact: "",
      notes: "Fictional sample data for trying ClearCare. Lives alone; her son visits most evenings.",
    },
  });

  save("provider", { name: "Dr. Alana Price", specialty: "Primary care", phone: "(555) 010-2231", address: "Maple Family Medicine, 40 Elm St" }); // PRV-1
  save("provider", { name: "Dr. Marco Rivera", specialty: "Cardiology", phone: "(555) 010-4410", address: "Valley Heart Center, 2nd floor" }); // PRV-2
  save("provider", { name: "Dr. Helen Cho", specialty: "Endocrinology", phone: "(555) 010-7782" }); // PRV-3
  save("provider", { name: "Valley Eye Associates", specialty: "Ophthalmology", phone: "(555) 010-3090" }); // PRV-4

  save("diagnosis", { name: "High blood pressure (hypertension)", status: "MANAGED", diagnosedOn: `${year - 12}-05-14`, providerId: "PRV-1" }); // DX-1
  save("diagnosis", { name: "Type 2 diabetes", status: "ACTIVE", diagnosedOn: `${year - 9}-03-02`, providerId: "PRV-3" }); // DX-2
  save("diagnosis", { name: "Atrial fibrillation", status: "ACTIVE", diagnosedOn: `${year - 3}-08-21`, providerId: "PRV-2", notes: "Irregular heartbeat. On a blood thinner to prevent stroke." }); // DX-3
  save("diagnosis", { name: "Underactive thyroid (hypothyroidism)", status: "MANAGED", diagnosedOn: `${year - 15}-01-10`, providerId: "PRV-1" }); // DX-4
  save("diagnosis", { name: "Osteoarthritis, left shoulder", status: "ACTIVE", diagnosedOn: `${year - 4}-11-02`, providerId: "PRV-1" }); // DX-5
  save("diagnosis", { name: "High cholesterol", status: "MANAGED", diagnosedOn: `${year - 6}-07-19`, providerId: "PRV-1" }); // DX-6

  save("medication", {
    name: "Metoprolol succinate ER",
    dose: "25 mg",
    instructions: "1 tablet every morning",
    timesPerDay: 1,
    purpose: "Slows the heart rate",
    diagnosisIds: ["DX-3", "DX-1"],
    prescriberId: "PRV-2",
    startDate: `${year - 3}-08-25`,
    refillDue: d(20),
  }); // MED-1
  save("medication", {
    name: "Apixaban (Eliquis)",
    dose: "5 mg",
    instructions: "1 tablet twice a day",
    timesPerDay: 2,
    purpose: "Blood thinner to prevent stroke",
    diagnosisIds: ["DX-3"],
    prescriberId: "PRV-2",
    startDate: `${year - 3}-08-25`,
    refillDue: d(4),
  }); // MED-2
  save("medication", {
    name: "Metformin",
    dose: "1000 mg",
    instructions: "1 tablet twice a day with meals",
    timesPerDay: 2,
    diagnosisIds: ["DX-2"],
    prescriberId: "PRV-3",
    startDate: `${year - 9}-03-10`,
  }); // MED-3
  save("medication", {
    name: "Levothyroxine",
    dose: "75 mcg",
    instructions: "Every morning on an empty stomach",
    timesPerDay: 1,
    diagnosisIds: ["DX-4"],
    prescriberId: "PRV-1",
    startDate: `${year - 15}-01-20`,
  }); // MED-4
  save("medication", { name: "Atorvastatin", dose: "40 mg", instructions: "1 tablet at bedtime", timesPerDay: 1, diagnosisIds: ["DX-6"], prescriberId: "PRV-1", startDate: `${year - 6}-08-01` }); // MED-5
  save("medication", { name: "Lisinopril", dose: "10 mg", instructions: "1 tablet every morning", timesPerDay: 1, diagnosisIds: ["DX-1"], prescriberId: "PRV-1", startDate: `${year - 12}-06-01` }); // MED-6
  save("medication", {
    name: "Acetaminophen (Tylenol)",
    dose: "500 mg",
    instructions: "1 to 2 tablets every 6 hours as needed for shoulder pain, at most 6 a day",
    asNeeded: true,
    diagnosisIds: ["DX-5"],
    startDate: `${year - 4}-11-02`,
  }); // MED-7
  save("medication", { name: "Ibuprofen", dose: "400 mg", instructions: "As needed for shoulder pain", asNeeded: true, diagnosisIds: ["DX-5"], startDate: `${year - 4}-11-02` }); // MED-8
  run({ type: "status", collection: "medication", id: "MED-8", status: "STOPPED", at: d(-200), note: "Stopped because she takes apixaban (bleeding risk)." });

  save("test", { name: "Hemoglobin A1C", kind: "LAB", unit: "%", refLow: "4.0", refHigh: "5.6", frequency: { every: 3, unit: "MONTH" }, diagnosisIds: ["DX-2"] }); // TST-1
  save("test", { name: "TSH (thyroid)", kind: "LAB", unit: "mIU/L", refLow: "0.4", refHigh: "4.0", frequency: { every: 12, unit: "MONTH" }, diagnosisIds: ["DX-4"] }); // TST-2
  save("test", { name: "Hemoglobin", kind: "LAB", unit: "g/dL", refLow: "12.0", refHigh: "15.5", frequency: { every: 6, unit: "MONTH" } }); // TST-3
  save("test", { name: "Potassium", kind: "LAB", unit: "mmol/L", refLow: "3.5", refHigh: "5.1", frequency: { every: 6, unit: "MONTH" }, diagnosisIds: ["DX-1"] }); // TST-4
  save("test", { name: "eGFR (kidney function)", kind: "LAB", unit: "mL/min/1.73m²", refLow: "60", frequency: { every: 6, unit: "MONTH" } }); // TST-5
  save("test", { name: "LDL cholesterol", kind: "LAB", unit: "mg/dL", refHigh: "100", frequency: { every: 12, unit: "MONTH" }, diagnosisIds: ["DX-6"] }); // TST-6
  save("test", {
    name: "Vitamin B12",
    kind: "LAB",
    unit: "pg/mL",
    refLow: "232",
    refHigh: "1245",
    frequency: { every: 12, unit: "MONTH" },
    diagnosisIds: ["DX-2"],
    notes: "Dr. Cho asked for a yearly check because long-term metformin can lower B12.",
  }); // TST-7
  save("test", { name: "Diabetic eye exam", kind: "SCREENING", frequency: { every: 12, unit: "MONTH" }, diagnosisIds: ["DX-2"] }); // TST-8

  const result = (testId: string, days: number, value: string, note = "") => save("result", { testId, date: d(days), value, note });
  result("TST-1", -300, "6.9");
  result("TST-1", -210, "7.0");
  result("TST-1", -118, "7.4");
  result("TST-2", -355, "2.1");
  result("TST-3", -200, "12.4");
  result("TST-3", -26, "11.3");
  result("TST-4", -26, "4.6");
  result("TST-5", -200, "58");
  result("TST-5", -26, "55");
  result("TST-6", -200, "92");
  result("TST-8", -400, "No diabetic eye disease", "Valley Eye Associates");

  save("appointment", {
    title: "Endocrinology follow-up",
    providerId: "PRV-3",
    specialty: "Endocrinology",
    start: at(-118, "14:00"),
    status: "COMPLETED",
    outcome: "A1C 7.4, up from 7.0. Keep metformin 1000 mg twice a day and work on diet. Recheck A1C in 3 months.",
    relatedIds: ["DX-2", "TST-1"],
  }); // APT-1
  save("appointment", {
    title: "Primary care check-up",
    providerId: "PRV-1",
    specialty: "Primary care",
    start: at(-26, "10:00"),
    status: "COMPLETED",
    location: "Maple Family Medicine",
    outcome:
      "Blood pressure 146/88 in the clinic. Heart rate 92 and irregular. Dr. Rivera's office agreed by phone to raise metoprolol from 25 mg to 50 mg. Labs drawn.",
    relatedIds: ["MED-1", "DX-3"],
  }); // APT-2
  save(
    "medication",
    {
      name: "Metoprolol succinate ER",
      dose: "50 mg",
      instructions: "1 tablet every morning",
      timesPerDay: 1,
      purpose: "Slows the heart rate",
      diagnosisIds: ["DX-3", "DX-1"],
      prescriberId: "PRV-2",
      startDate: `${year - 3}-08-25`,
      refillDue: d(20),
      changedOn: d(-26),
    },
    "MED-1",
  );
  save("appointment", {
    title: "Cardiology follow-up: heart rate after the metoprolol increase",
    providerId: "PRV-2",
    specialty: "Cardiology",
    start: at(6, "10:30"),
    location: "Valley Heart Center, 2nd floor",
    prep: "Bring the home blood pressure and heart rate log.",
    relatedIds: ["MED-1", "DX-3"],
  }); // APT-3
  save("appointment", { title: "Annual wellness visit", providerId: "PRV-1", specialty: "Primary care", start: at(25, "09:00"), location: "Maple Family Medicine" }); // APT-4
  save("appointment", { title: "Diabetic eye exam", providerId: "PRV-4", specialty: "Ophthalmology", bookBy: d(14), relatedIds: ["TST-8", "DX-2"] }); // APT-5

  const checkIn = (days: number, time: string, data: Record<string, unknown>) => save("checkIn", { at: at(days, time), ...data });
  checkIn(-40, "18:10", { overall: 4, energy: 4, bpSys: 138, bpDia: 84, heartRate: 88, note: "Good day. Walked to the mailbox and back." });
  checkIn(-33, "19:00", { overall: 4, energy: 3, bpSys: 142, bpDia: 86, heartRate: 94, symptoms: [{ name: "Shoulder pain", bodyArea: "left shoulder", severity: 3 }], note: "Shoulder sore after gardening." });
  checkIn(-28, "20:15", { overall: 3, energy: 3, bpSys: 148, bpDia: 90, heartRate: 96, symptoms: [{ name: "Palpitations", bodyArea: "", severity: 4 }], note: "Heart felt fluttery in the evening." });
  checkIn(-21, "18:30", { overall: 4, energy: 3, bpSys: 134, bpDia: 80, heartRate: 70 });
  checkIn(-18, "19:05", { overall: 3, energy: 2, bpSys: 128, bpDia: 76, heartRate: 62, symptoms: [{ name: "Fatigue", bodyArea: "", severity: 4 }], note: "More tired than usual. Napped twice." });
  checkIn(-14, "18:45", { overall: 3, energy: 2, bpSys: 126, bpDia: 74, heartRate: 58, symptoms: [{ name: "Fatigue", bodyArea: "", severity: 5 }] });
  checkIn(-10, "19:20", {
    overall: 3,
    energy: 2,
    bpSys: 124,
    bpDia: 72,
    heartRate: 57,
    symptoms: [
      { name: "Fatigue", bodyArea: "", severity: 5 },
      { name: "Dizziness when standing up", bodyArea: "", severity: 3 },
    ],
    note: "Lightheaded getting out of her chair.",
  });
  checkIn(-7, "18:40", { overall: 2, energy: 2, bpSys: 118, bpDia: 70, heartRate: 54, symptoms: [{ name: "Fatigue", bodyArea: "", severity: 6 }] });
  checkIn(-5, "19:10", { overall: 3, energy: 2, heartRate: 56, symptoms: [{ name: "Shoulder pain", bodyArea: "left shoulder", severity: 3 }] });
  checkIn(-3, "19:30", {
    overall: 2,
    energy: 1,
    bpSys: 116,
    bpDia: 68,
    heartRate: 53,
    symptoms: [
      { name: "Fatigue", bodyArea: "", severity: 7 },
      { name: "Cold hands", bodyArea: "", severity: 2 },
    ],
    note: "Very sluggish. Didn't want to go to church.",
  });
  checkIn(-1, "18:50", {
    overall: 2,
    energy: 2,
    bpSys: 120,
    bpDia: 70,
    heartRate: 55,
    symptoms: [
      { name: "Fatigue", bodyArea: "", severity: 6 },
      { name: "Arm pain", bodyArea: "left arm", severity: 4 },
    ],
    note: "Left arm sore after carrying the groceries in. She says it's her shoulder again.",
  });

  save("question", { text: "Should she get the shoulder X-ray you mentioned last year?", appointmentId: "APT-4", relatedIds: ["DX-5"] });

  return { ...state, profile: { ...state.profile, sample: true } };
}

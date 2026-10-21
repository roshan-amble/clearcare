import { describe, expect, it } from "vitest";
import { redFlags } from "./redflags.js";

const level = (text: string, meds: string[] = []) => redFlags(text, { activeMedicationNames: meds }).level;
const ids = (text: string, meds: string[] = []) => redFlags(text, { activeMedicationNames: meds }).hits.map((h) => h.id);

describe("red flags", () => {
  it("leaves ordinary tiredness and a sore arm to judgment", () => {
    expect(level("She's been feeling sluggish and weak this week")).toBeNull();
    expect(level("Her left arm has been hurting since yesterday")).toBeNull();
    expect(level("She fell asleep early after dinner")).toBeNull();
  });
  it("asks for a call today for arm pain with unusual tiredness", () => {
    expect(level("Her left arm hurts and she's really tired")).toBe("TODAY");
    expect(level("she is feeling sluggish and weak and her arm is hurting")).toBe("TODAY");
    expect(ids("Feeling weak. Pain in her left shoulder.")).toEqual(["arm-with-fatigue"]);
  });
  it("calls 911 for arm or jaw pain with cardiac signs", () => {
    expect(level("Her arm hurts and she is sweaty and nauseous")).toBe("EMERGENCY");
    expect(ids("jaw pain and she feels dizzy")).toEqual(["arm-with-cardiac-signs"]);
    expect(ids("Her arm hurts and she's sweating and very tired")).toEqual(["arm-with-cardiac-signs"]);
  });
  it("calls 911 for chest pain and stroke signs", () => {
    expect(level("she has chest pressure")).toBe("EMERGENCY");
    expect(level("pain in her chest when she climbs stairs")).toBe("EMERGENCY");
    expect(ids("Her face is drooping and her speech is slurred")).toEqual(["stroke"]);
    expect(ids("her right arm went numb")).toEqual(["stroke"]);
    expect(ids("she can't lift her left arm")).toEqual(["stroke"]);
  });
  it("respects simple negation in the same clause", () => {
    expect(level("No chest pain, but her arm hurts")).toBeNull();
    expect(level("She denies chest pain")).toBeNull();
    expect(level("She isn't short of breath")).toBeNull();
    expect(level("She is not eating well and her chest hurts")).toBe("EMERGENCY");
    expect(level("No chest pain or sweating, but her arm hurts")).toBeNull();
    expect(level("She has no chest pain, sweating, or nausea. Her left arm hurts.")).toBeNull();
  });
  it("treats unclear wording as present", () => {
    expect(level("She never had chest pain like this before")).toBe("EMERGENCY");
    expect(level("Not sure if it's chest pain or heartburn")).toBe("EMERGENCY");
  });
  it("knows a head injury is worse on a blood thinner", () => {
    expect(level("She fell and hit her head", ["Apixaban (Eliquis)"])).toBe("EMERGENCY");
    expect(level("She fell and hit her head", ["Metformin"])).toBe("TODAY");
    expect(level("She tripped on the rug")).toBe("TODAY");
  });
  it("separates sudden confusion from new confusion", () => {
    expect(level("She is suddenly confused")).toBe("EMERGENCY");
    expect(ids("She seems confused tonight")).toEqual(["confusion"]);
  });
  it("finds the other warning signs", () => {
    expect(level("She can't catch her breath")).toBe("EMERGENCY");
    expect(level("she passed out in the kitchen")).toBe("EMERGENCY");
    expect(level("she's been short of breath walking to the car")).toBe("TODAY");
    expect(level("fever of 101.5 since this morning")).toBe("TODAY");
    expect(level("black tarry stools")).toBe("TODAY");
    expect(level("her left calf is swollen")).toBe("TODAY");
    expect(level("She said she wants to die")).toBe("EMERGENCY");
  });
});

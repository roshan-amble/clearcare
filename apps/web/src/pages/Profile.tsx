import { useEffect, useRef, useState, type FormEvent } from "react";
import { BLOOD_TYPES, profileSummary } from "@clearcare/domain";
import { useAction, useData } from "../data";
import { Field, Modal, ProviderForm, useEditor } from "../forms";
import { Card } from "../ui";

export function Profile() {
  const { payload, command } = useData();
  const { state, view } = payload;
  const p = state.profile;
  const summary = profileSummary(state, view.today);
  const inches = p.heightIn === null || p.heightIn === undefined ? null : Number(p.heightIn);
  const [v, setV] = useState({
    name: p.name,
    birthDate: p.birthDate ?? "",
    sex: p.sex ?? "",
    feet: inches === null ? "" : String(Math.floor(inches / 12)),
    inches: inches === null ? "" : String(Math.round((inches % 12) * 10) / 10),
    bloodType: p.bloodType ?? "",
    allergies: p.allergies.join("\n"),
    primaryProviderId: p.primaryProviderId ?? "",
    pharmacy: p.pharmacy ?? "",
    preferredHospital: p.preferredHospital ?? "",
    mobility: p.mobility ?? "",
    livingSituation: p.livingSituation ?? "",
    lifestyle: p.lifestyle ?? "",
    advanceDirective: p.advanceDirective ?? "",
    healthcareProxy: p.healthcareProxy ?? "",
    emergencyContact: p.emergencyContact,
    insurance: p.insurance ?? "",
    notes: p.notes,
  });
  const set = (key: keyof typeof v) => (value: string) => setV((x) => ({ ...x, [key]: value }));
  const { busy, run } = useAction();
  const doctor = useEditor<true>();
  // The doctors that existed when "Add a doctor" was chosen, so the one just added can be selected.
  const before = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (before.current === null) return;
    const added = state.providers.find((d) => !before.current!.has(d.id));
    if (added !== undefined) setV((x) => ({ ...x, primaryProviderId: added.id }));
    if (added !== undefined || doctor.editor === null) before.current = null;
  }, [state.providers, doctor.editor]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const height = v.feet === "" && v.inches === "" ? null : String(Number(v.feet || 0) * 12 + Number(v.inches || 0));
    void run(
      () =>
        command({
          type: "profile.save",
          profile: {
            ...v,
            birthYear: p.birthYear,
            heightIn: height,
            sex: v.sex === "" ? null : v.sex,
            bloodType: v.bloodType === "" ? null : v.bloodType,
            primaryProviderId: v.primaryProviderId === "" ? null : v.primaryProviderId,
            allergies: v.allergies.split(/[\n,]/).map((a) => a.trim()).filter((a) => a !== ""),
          },
        }),
      "Saved.",
    );
  };

  const facts = [
    summary.age === null ? null : `${summary.ageApproximate ? "about " : ""}${summary.age} years old`,
    p.sex === null ? null : p.sex.charAt(0) + p.sex.slice(1).toLowerCase(),
    summary.heightText,
    summary.latestWeightLb === null ? null : `${summary.latestWeightLb} lb`,
    summary.bmi === null ? null : `BMI ${summary.bmi}`,
    p.bloodType ?? null,
  ].filter((x) => x !== null);

  return (
    <>
    <form onSubmit={save} className="profile">
      <div className="profile-head">
        <div className="avatar-lg">{p.name.charAt(0).toUpperCase()}</div>
        <div>
          <h2>{p.name}</h2>
          <p className="muted">{facts.length === 0 ? "Add her details below." : facts.join(" · ")}</p>
        </div>
      </div>

      <Card title="Basics">
        <div className="form-grid">
          <Field label="Name">
            <input value={v.name} onChange={(e) => set("name")(e.target.value)} required />
          </Field>
          <Field label="Birth date">
            <input type="date" value={v.birthDate} onChange={(e) => set("birthDate")(e.target.value)} />
          </Field>
          <Field label="Sex">
            <select value={v.sex} onChange={(e) => set("sex")(e.target.value)}>
              <option value="">Not set</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Height" group>
            <div className="height-inputs">
              <input inputMode="numeric" aria-label="Feet" value={v.feet} onChange={(e) => set("feet")(e.target.value)} />
              <span>ft</span>
              <input inputMode="decimal" aria-label="Inches" value={v.inches} onChange={(e) => set("inches")(e.target.value)} />
              <span>in</span>
            </div>
          </Field>
          <Field label="Blood type">
            <select value={v.bloodType} onChange={(e) => set("bloodType")(e.target.value)}>
              <option value="">Unknown</option>
              {BLOOD_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weight" group hint="Logged on the Diet page.">
            <span>{summary.latestWeightLb === null ? "Not logged yet" : `${summary.latestWeightLb} lb`}</span>
          </Field>
          <Field label="Allergies" wide>
            <textarea rows={2} value={v.allergies} onChange={(e) => set("allergies")(e.target.value)} placeholder="One per line, with the reaction" />
          </Field>
        </div>
      </Card>

      <Card title="Care">
        <div className="form-grid">
          <Field label="Primary doctor">
            <select
              value={v.primaryProviderId}
              onChange={(e) => {
                if (e.target.value === "new") {
                  before.current = new Set(state.providers.map((d) => d.id));
                  doctor.open(true);
                } else set("primaryProviderId")(e.target.value);
              }}
            >
              <option value="">Not set</option>
              {state.providers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.specialty === "" ? "" : `, ${d.specialty}`}
                </option>
              ))}
              <option value="new">Add a doctor…</option>
            </select>
          </Field>
          <Field label="Pharmacy">
            <input value={v.pharmacy} onChange={(e) => set("pharmacy")(e.target.value)} />
          </Field>
          <Field label="Preferred hospital">
            <input value={v.preferredHospital} onChange={(e) => set("preferredHospital")(e.target.value)} />
          </Field>
          <Field label="Mobility and aids">
            <input value={v.mobility} onChange={(e) => set("mobility")(e.target.value)} placeholder="Cane, hearing aids, glasses" />
          </Field>
          <Field label="Living situation">
            <input value={v.livingSituation} onChange={(e) => set("livingSituation")(e.target.value)} />
          </Field>
          <Field label="Lifestyle">
            <input value={v.lifestyle} onChange={(e) => set("lifestyle")(e.target.value)} placeholder="Activity, sleep, smoking, alcohol" />
          </Field>
        </div>
      </Card>

      <Card title="Emergency">
        <div className="form-grid">
          <Field label="Emergency contact">
            <input value={v.emergencyContact} onChange={(e) => set("emergencyContact")(e.target.value)} />
          </Field>
          <Field label="Healthcare proxy">
            <input value={v.healthcareProxy} onChange={(e) => set("healthcareProxy")(e.target.value)} />
          </Field>
          <Field label="Advance directive">
            <input value={v.advanceDirective} onChange={(e) => set("advanceDirective")(e.target.value)} placeholder="For example: living will on file" />
          </Field>
          <Field label="Insurance">
            <input value={v.insurance} onChange={(e) => set("insurance")(e.target.value)} />
          </Field>
          <Field label="Notes" wide>
            <textarea rows={3} value={v.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="form-foot">
        <button type="submit" className="btn primary" disabled={busy}>
          Save profile
        </button>
      </div>
    </form>
    <Modal open={doctor.editor !== null} title="New doctor" onClose={doctor.close}>
      <ProviderForm onDone={doctor.close} />
    </Modal>
    </>
  );
}

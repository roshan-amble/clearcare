import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  APPOINTMENT_STATUSES,
  DIAGNOSIS_STATUSES,
  FREQUENCY_UNITS,
  MEDICATION_STATUSES,
  QUESTION_STATUSES,
  TEST_KINDS,
  TRACK_STATUSES,
  checkInText,
  messageFlags,
  type Appointment,
  type CheckIn,
  type Command,
  type DeleteCollection,
  type Diagnosis,
  type Medication,
  type Provider,
  type Question,
  type Result,
  type StatusCollection,
  type Test,
  isReportTest,
} from "@clearcare/domain";
import { useAction, useData } from "./data";
import { fileLabel, KIND_LABEL, statusLabel } from "./format";
import { FlagBanner, History, Icon } from "./ui";

export function Modal(props: { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className="modal" onClose={props.onClose}>
      <div className="modal-h">
        <h2>{props.title}</h2>
        <button type="button" className="btn ghost sm" onClick={props.onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-b">{props.open ? props.children : null}</div>
    </dialog>
  );
}

type Values = Record<string, unknown>;

function useValues(initial: Values) {
  const [values, setValues] = useState<Values>(initial);
  const set = (key: string) => (value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  return { values, set, setValues };
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** A labeled field. A group of several inputs gets a caption instead of a label. */
export function Field(props: { readonly label: string; readonly hint?: string; readonly wide?: boolean; readonly group?: boolean; readonly children: ReactNode }) {
  return (
    <div className={`field ${props.wide === true ? "wide" : ""}`}>
      {props.group === true ? (
        <>
          <span className="label">{props.label}</span>
          <div>{props.children}</div>
        </>
      ) : (
        <label>
          {props.label}
          <div style={{ marginTop: 5 }}>{props.children}</div>
        </label>
      )}
      {props.hint === undefined ? null : <span className="hint">{props.hint}</span>}
    </div>
  );
}

function TextInput(props: { readonly value: unknown; readonly onChange: (v: string) => void; readonly type?: string; readonly placeholder?: string; readonly required?: boolean; readonly inputMode?: "decimal" | "numeric" }) {
  return (
    <input
      type={props.type ?? "text"}
      value={str(props.value)}
      placeholder={props.placeholder}
      required={props.required}
      inputMode={props.inputMode}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function TextArea(props: { readonly value: unknown; readonly onChange: (v: string) => void; readonly rows?: number; readonly placeholder?: string }) {
  return <textarea rows={props.rows ?? 3} value={str(props.value)} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />;
}

function Select(props: { readonly value: unknown; readonly onChange: (v: string) => void; readonly options: readonly (readonly [string, string])[]; readonly empty?: string }) {
  return (
    <select value={str(props.value)} onChange={(e) => props.onChange(e.target.value)}>
      {props.empty === undefined ? null : <option value="">{props.empty}</option>}
      {props.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Scale(props: { readonly value: number | null; readonly onChange: (v: number | null) => void; readonly labels: readonly string[] }) {
  return (
    <div className="seg" role="group">
      {props.labels.map((label, i) => (
        <button key={label} type="button" aria-pressed={props.value === i + 1} onClick={() => props.onChange(props.value === i + 1 ? null : i + 1)} title={label}>
          {i + 1} <span className="small">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Submit and delete buttons, the error line, and the command call. */
function useSubmit(onDone: () => void) {
  const { command, notify } = useData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (commands: Command[], done: string) => {
    setBusy(true);
    setError(null);
    try {
      for (const c of commands) await command(c);
      notify(done);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

function Foot(props: { readonly error: string | null; readonly busy: boolean; readonly onCancel: () => void; readonly onDelete?: (() => void) | undefined; readonly label?: string }) {
  return (
    <div className="form-foot">
      {props.error === null ? null : <span className="form-error">{props.error}</span>}
      {props.onDelete === undefined ? null : (
        <button type="button" className="btn danger" onClick={props.onDelete} disabled={props.busy} style={{ marginRight: props.error === null ? "auto" : undefined }}>
          <Icon name="trash" /> Delete
        </button>
      )}
      <button type="button" className="btn" onClick={props.onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={props.busy}>
        {props.busy ? "Saving…" : props.label ?? "Save"}
      </button>
    </div>
  );
}

const del = (collection: DeleteCollection, id: string): Command => ({ type: "delete", collection, id });
const confirmDelete = (what: string) => window.confirm(`Delete ${what}? This cannot be undone (a daily backup is kept in data/backups).`);

// ---------------------------------------------------------------------------------------------------------------

export function ProviderForm({ provider, onDone }: { readonly provider?: Provider; readonly onDone: () => void }) {
  const { values, set } = useValues({ name: "", specialty: "", phone: "", address: "", notes: "", ...provider });
  const { error, busy, submit } = useSubmit(onDone);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit([{ type: "save", collection: "provider", id: provider?.id ?? null, data: values }], provider === undefined ? "Doctor added." : "Doctor saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Name">
          <TextInput value={values["name"]} onChange={set("name")} required placeholder="Dr. Jane Smith" />
        </Field>
        <Field label="Specialty">
          <TextInput value={values["specialty"]} onChange={set("specialty")} placeholder="Cardiology" />
        </Field>
        <Field label="Phone">
          <TextInput value={values["phone"]} onChange={set("phone")} type="tel" />
        </Field>
        <Field label="Address or clinic">
          <TextInput value={values["address"]} onChange={set("address")} />
        </Field>
        <Field label="Notes" wide>
          <TextArea value={values["notes"]} onChange={set("notes")} rows={2} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={provider === undefined ? undefined : () => confirmDelete(provider.name) && void submit([del("provider", provider.id)], "Doctor deleted.")} />
    </form>
  );
}

export function AppointmentForm({ appointment, defaults, onDone }: { readonly appointment?: Appointment; readonly defaults?: Values; readonly onDone: () => void }) {
  const { payload } = useData();
  const { values, set } = useValues({ title: "", providerId: "", specialty: "", start: "", bookBy: "", location: "", prep: "", outcome: "", relatedIds: [], ...defaults, ...appointment });
  const { error, busy, submit } = useSubmit(onDone);
  const doctors = payload.state.providers.map((p) => [p.id, `${p.name}${p.specialty === "" ? "" : ` (${p.specialty})`}`] as const);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const start = str(values["start"]);
    const current = appointment?.status;
    const status = current === "COMPLETED" || current === "CANCELLED" ? current : start === "" ? "TO_BOOK" : "SCHEDULED";
    const data = { ...values, providerId: str(values["providerId"]) || null, status };
    void submit([{ type: "save", collection: "appointment", id: appointment?.id ?? null, data }], appointment === undefined ? "Appointment added." : "Appointment saved.");
  };
  const pickDoctor = (id: string) => {
    set("providerId")(id);
    const doctor = payload.state.providers.find((p) => p.id === id);
    if (doctor !== undefined && str(values["specialty"]) === "") set("specialty")(doctor.specialty);
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Reason for the visit" wide>
          <TextInput value={values["title"]} onChange={set("title")} required placeholder="Cardiology follow-up" />
        </Field>
        <Field label="Doctor">
          <Select value={values["providerId"]} onChange={pickDoctor} options={doctors} empty="Not chosen yet" />
        </Field>
        <Field label="Specialty">
          <TextInput value={values["specialty"]} onChange={set("specialty")} />
        </Field>
        <Field label="Date and time">
          <TextInput type="datetime-local" value={values["start"]} onChange={set("start")} />
        </Field>
        <Field label="Book by" hint="If it isn't booked yet.">
          <TextInput type="date" value={values["bookBy"]} onChange={set("bookBy")} />
        </Field>
        <Field label="Location" wide>
          <TextInput value={values["location"]} onChange={set("location")} />
        </Field>
        <Field label="Preparation" wide>
          <TextArea value={values["prep"]} onChange={set("prep")} rows={2} />
        </Field>
        {appointment?.status === "COMPLETED" ? (
          <Field label="Visit notes" wide>
            <TextArea value={values["outcome"]} onChange={set("outcome")} rows={3} />
          </Field>
        ) : null}
      </div>
      {appointment !== undefined && (appointment.status === "SCHEDULED" || appointment.status === "TO_BOOK") ? (
        <div>
          <button
            type="button"
            className="btn sm ghost danger"
            disabled={busy}
            onClick={() => window.confirm("Mark this visit as cancelled?") && void submit([{ type: "status", collection: "appointment", id: appointment.id, status: "CANCELLED" }], "Visit cancelled.")}
          >
            Cancel this visit
          </button>
        </div>
      ) : null}
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={appointment === undefined ? undefined : () => confirmDelete("this appointment") && void submit([del("appointment", appointment.id)], "Appointment deleted.")} />
      {appointment === undefined ? null : <History history={appointment.history} />}
    </form>
  );
}

const STATUS_OPTIONS: Record<StatusCollection, readonly string[]> = {
  appointment: APPOINTMENT_STATUSES,
  medication: MEDICATION_STATUSES,
  diagnosis: DIAGNOSIS_STATUSES,
  test: TRACK_STATUSES,
  question: QUESTION_STATUSES,
};

/** Updates the status of anything that has one, with a note and the date it happened. */
export function StatusForm(props: { readonly collection: StatusCollection; readonly id: string; readonly current: string; readonly next?: string; readonly onDone: () => void; readonly outcome?: string; readonly answer?: string }) {
  const { payload } = useData();
  const options = STATUS_OPTIONS[props.collection].filter((s) => s !== props.current || props.collection === "question");
  const [status, setStatus] = useState(props.next ?? options[0] ?? props.current);
  const [note, setNote] = useState("");
  const [at, setAt] = useState(payload.view.today);
  const [outcome, setOutcome] = useState(props.outcome ?? "");
  const [answer, setAnswer] = useState(props.answer ?? "");
  const { error, busy, submit } = useSubmit(props.onDone);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const command: Command = {
      type: "status",
      collection: props.collection,
      id: props.id,
      status,
      note,
      at: at === payload.view.today ? null : at,
      ...(props.collection === "appointment" ? { outcome } : {}),
      ...(props.collection === "question" ? { answer } : {}),
    };
    void submit([command], `Status set to ${statusLabel(status).toLowerCase()}.`);
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="New status">
          <Select value={status} onChange={setStatus} options={options.map((s) => [s, statusLabel(s)] as const)} />
        </Field>
        {props.collection === "question" ? null : (
          <Field label="When it happened">
            <TextInput type="date" value={at} onChange={setAt} />
          </Field>
        )}
        {props.collection === "appointment" && status === "COMPLETED" ? (
          <Field label="What the doctor said" wide>
            <TextArea value={outcome} onChange={setOutcome} rows={4} />
          </Field>
        ) : null}
        {props.collection === "question" && status === "ASKED" ? (
          <Field label="The answer" wide>
            <TextArea value={answer} onChange={setAnswer} rows={3} />
          </Field>
        ) : null}
        {props.collection === "question" ? null : (
          <Field label="Note" wide>
            <TextArea value={note} onChange={setNote} rows={2} />
          </Field>
        )}
      </div>
      <Foot error={error} busy={busy} onCancel={props.onDone} label="Update status" />
    </form>
  );
}

function DiagnosisPicker({ value, onChange }: { readonly value: unknown; readonly onChange: (ids: string[]) => void }) {
  const { payload } = useData();
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  if (payload.state.diagnoses.length === 0) return <span className="muted small">No diagnoses recorded yet.</span>;
  return (
    <div className="pick-list" role="group">
      {payload.state.diagnoses.map((d) => (
        <label key={d.id} className={selected.has(d.id) ? "pick on" : "pick"}>
          <input
            type="checkbox"
            checked={selected.has(d.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(d.id);
              else next.delete(d.id);
              onChange([...next]);
            }}
          />
          <span>{d.name}</span>
        </label>
      ))}
    </div>
  );
}

export function MedicationForm({ medication, onDone }: { readonly medication?: Medication; readonly onDone: () => void }) {
  const { payload } = useData();
  const { values, set } = useValues({
    name: "",
    dose: "",
    instructions: "",
    timesPerDay: "",
    asNeeded: false,
    purpose: "",
    diagnosisIds: [],
    prescriberId: "",
    startDate: "",
    refillDue: "",
    notes: "",
    changedOn: payload.view.today,
    ...medication,
  });
  const { error, busy, submit } = useSubmit(onDone);
  const changing =
    medication !== undefined && (str(values["dose"]) !== medication.dose || str(values["instructions"]) !== medication.instructions || values["status"] !== medication.status);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const data = { ...values, prescriberId: str(values["prescriberId"]) || null, timesPerDay: str(values["timesPerDay"]) === "" ? null : Number(values["timesPerDay"]), changedOn: changing ? values["changedOn"] : null };
    void submit([{ type: "save", collection: "medication", id: medication?.id ?? null, data }], medication === undefined ? "Medication added." : "Medication saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Medication">
          <TextInput value={values["name"]} onChange={set("name")} required placeholder="Metoprolol succinate ER" />
        </Field>
        <Field label="Dose">
          <TextInput value={values["dose"]} onChange={set("dose")} placeholder="50 mg" />
        </Field>
        <Field label="How to take it" wide>
          <TextInput value={values["instructions"]} onChange={set("instructions")} placeholder="1 tablet every morning" />
        </Field>
        <Field label="Times a day">
          <TextInput type="number" inputMode="numeric" value={values["timesPerDay"]} onChange={set("timesPerDay")} />
        </Field>
        <Field label="As needed" group>
          <label className="check">
            <input type="checkbox" checked={values["asNeeded"] === true} onChange={(e) => set("asNeeded")(e.target.checked)} /> Only when needed
          </label>
        </Field>
        {medication === undefined ? null : (
          <Field label="Status">
            <Select value={values["status"]} onChange={set("status")} options={MEDICATION_STATUSES.map((st) => [st, statusLabel(st)] as const)} />
          </Field>
        )}
        {changing ? (
          <Field label="Change took effect on">
            <TextInput type="date" value={values["changedOn"]} onChange={set("changedOn")} />
          </Field>
        ) : null}
        <Field label="What it is for" wide>
          <TextInput value={values["purpose"]} onChange={set("purpose")} placeholder="Slows the heart rate" />
        </Field>
        <Field label="For these conditions" wide group>
          <DiagnosisPicker value={values["diagnosisIds"]} onChange={set("diagnosisIds")} />
        </Field>
        <Field label="Prescribed by">
          <Select value={values["prescriberId"]} onChange={set("prescriberId")} options={payload.state.providers.map((p) => [p.id, p.name] as const)} empty="Not recorded" />
        </Field>
        <Field label="Started on">
          <TextInput type="date" value={values["startDate"]} onChange={set("startDate")} />
        </Field>
        <Field label="Refill due">
          <TextInput type="date" value={values["refillDue"]} onChange={set("refillDue")} />
        </Field>
        <Field label="Notes" wide>
          <TextArea value={values["notes"]} onChange={set("notes")} rows={2} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={medication === undefined ? undefined : () => confirmDelete(medication.name) && void submit([del("medication", medication.id)], "Medication deleted.")} />
      {medication === undefined ? null : <History history={medication.history} />}
    </form>
  );
}

export function DiagnosisForm({ diagnosis, onDone }: { readonly diagnosis?: Diagnosis; readonly onDone: () => void }) {
  const { payload } = useData();
  const { values, set } = useValues({ name: "", diagnosedOn: "", providerId: "", notes: "", status: "ACTIVE", ...diagnosis });
  const { error, busy, submit } = useSubmit(onDone);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit([{ type: "save", collection: "diagnosis", id: diagnosis?.id ?? null, data: { ...values, providerId: str(values["providerId"]) || null } }], diagnosis === undefined ? "Diagnosis added." : "Diagnosis saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Diagnosis" wide>
          <TextInput value={values["name"]} onChange={set("name")} required placeholder="Type 2 diabetes" />
        </Field>
        <Field label="Diagnosed on">
          <TextInput type="date" value={values["diagnosedOn"]} onChange={set("diagnosedOn")} />
        </Field>
        <Field label="Doctor">
          <Select value={values["providerId"]} onChange={set("providerId")} options={payload.state.providers.map((p) => [p.id, p.name] as const)} empty="Not recorded" />
        </Field>
        <Field label="Status">
          <Select value={values["status"]} onChange={set("status")} options={DIAGNOSIS_STATUSES.map((s) => [s, statusLabel(s)] as const)} />
        </Field>
        <Field label="Notes" wide>
          <TextArea value={values["notes"]} onChange={set("notes")} rows={3} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={diagnosis === undefined ? undefined : () => confirmDelete(diagnosis.name) && void submit([del("diagnosis", diagnosis.id)], "Diagnosis deleted.")} />
      {diagnosis === undefined ? null : <History history={diagnosis.history} />}
    </form>
  );
}

export function TestForm({ test, kind, onDone }: { readonly test?: Test; readonly kind?: string; readonly onDone: () => void }) {
  const { values, set } = useValues({
    name: "",
    kind: kind ?? "LAB",
    unit: "",
    refLow: "",
    refHigh: "",
    every: test?.frequency?.every ?? "",
    unitOfTime: test?.frequency?.unit ?? "MONTH",
    diagnosisIds: [],
    notes: "",
    ...test,
  });
  const { error, busy, submit } = useSubmit(onDone);
  const reportKind = isReportTest({ kind: values["kind"] as Test["kind"], unit: str(values["unit"]), refLow: null, refHigh: null });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const frequency = str(values["every"]) === "" ? null : { every: Number(values["every"]), unit: values["unitOfTime"] };
    // A report has no unit or range: clear any left from before the kind changed.
    const data = reportKind ? { ...values, unit: "", refLow: null, refHigh: null, frequency } : { ...values, frequency };
    void submit([{ type: "save", collection: "test", id: test?.id ?? null, data }], test === undefined ? "Test added." : "Test saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Test" wide>
          <TextInput value={values["name"]} onChange={set("name")} required placeholder={reportKind ? "MRI lumbar spine" : "Hemoglobin A1C"} />
        </Field>
        <Field label="Kind">
          <Select value={values["kind"]} onChange={set("kind")} options={TEST_KINDS.map((k) => [k, KIND_LABEL[k] ?? k] as const)} />
        </Field>
        {reportKind ? null : (
          <>
            <Field label="Unit">
              <TextInput value={values["unit"]} onChange={set("unit")} placeholder="%" />
            </Field>
            <Field label="Normal range, low">
              <TextInput inputMode="decimal" value={values["refLow"]} onChange={set("refLow")} placeholder="4.0" />
            </Field>
            <Field label="Normal range, high">
              <TextInput inputMode="decimal" value={values["refHigh"]} onChange={set("refHigh")} placeholder="5.6" />
            </Field>
          </>
        )}
        <Field label="Repeat every">
          <TextInput type="number" inputMode="numeric" value={values["every"]} onChange={set("every")} />
        </Field>
        <Field label="Unit of time">
          <Select value={values["unitOfTime"]} onChange={set("unitOfTime")} options={FREQUENCY_UNITS.map((u) => [u, `${u.toLowerCase()}s`] as const)} />
        </Field>
        {test === undefined ? null : (
          <Field label="Status">
            <Select value={values["status"]} onChange={set("status")} options={TRACK_STATUSES.map((st) => [st, statusLabel(st)] as const)} />
          </Field>
        )}
        <Field label="For these conditions" wide group>
          <DiagnosisPicker value={values["diagnosisIds"]} onChange={set("diagnosisIds")} />
        </Field>
        <Field label="Notes" wide>
          <TextArea value={values["notes"]} onChange={set("notes")} rows={2} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={test === undefined ? undefined : () => confirmDelete(`${test.name} and all its results`) && void submit([del("test", test.id)], "Test deleted.")} />
      {test === undefined ? null : <History history={test.history} />}
    </form>
  );
}

/** Uploaded documents to link, with a filter when there are many. */
function FilePicker({ value, onChange }: { readonly value: unknown; readonly onChange: (ids: string[]) => void }) {
  const { payload } = useData();
  const [filter, setFilter] = useState("");
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  const files = payload.state.files
    .slice()
    .sort((a, b) => (b.read?.date ?? b.uploadedAt).localeCompare(a.read?.date ?? a.uploadedAt));
  if (files.length === 0) return <span className="muted small">Nothing uploaded yet. Upload it on the Documents page.</span>;
  const q = filter.trim().toLowerCase();
  const shown = files.filter((f) => selected.has(f.id) || q === "" || `${f.name} ${fileLabel(f)} ${f.read?.summary ?? ""}`.toLowerCase().includes(q));
  return (
    <div className="file-picker">
      {files.length > 6 ? <input className="filter" placeholder="Find a document" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a document" /> : null}
      <div className="pick-list scroll">
        {shown.map((f) => (
          <label key={f.id} className={selected.has(f.id) ? "pick on" : "pick"}>
            <input
              type="checkbox"
              checked={selected.has(f.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(f.id);
                else next.delete(f.id);
                onChange([...next]);
              }}
            />
            <span>{fileLabel(f)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** A lab value, or a written report for a scan, biopsy or procedure. Opens empty to add, or with a result to edit. */
export function ResultForm({ test, result, onDone }: { readonly test: Test; readonly result?: Result; readonly onDone: () => void }) {
  const { payload } = useData();
  const report = isReportTest(test);
  const precision = result?.datePrecision ?? "DAY";
  const { values, set } = useValues({
    date: result === undefined ? payload.view.today : precision === "MONTH" ? result.date.slice(0, 7) : precision === "YEAR" ? result.date.slice(0, 4) : result.date,
    precision,
    value: result?.value ?? "",
    impression: result?.impression ?? "",
    findings: result?.findings ?? "",
    facility: result?.facility ?? "",
    providerId: result?.providerId ?? "",
    fileIds: result?.fileIds ?? [],
    note: result?.note ?? "",
  });
  const { error, busy, submit } = useSubmit(onDone);
  const changePrecision = (p: string) => {
    const d = str(values["date"]) || payload.view.today;
    const full = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : /^\d{4}-\d{2}$/.test(d) ? `${d}-01` : `${d.slice(0, 4)}-01-01`;
    set("precision")(p);
    set("date")(p === "MONTH" ? full.slice(0, 7) : p === "YEAR" ? full.slice(0, 4) : full);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const { precision: _p, ...rest } = values;
    const data = { ...rest, testId: test.id, providerId: str(values["providerId"]) === "" ? null : values["providerId"] };
    void submit([{ type: "save", collection: "result", id: result?.id ?? null, data }], result === undefined ? (report ? "Report added." : "Result added.") : "Saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="Date">
          {values["precision"] === "MONTH" ? (
            <TextInput type="month" value={values["date"]} onChange={set("date")} required placeholder="2026-03" />
          ) : values["precision"] === "YEAR" ? (
            <TextInput inputMode="numeric" value={values["date"]} onChange={set("date")} required placeholder="2026" />
          ) : (
            <TextInput type="date" value={values["date"]} onChange={set("date")} required />
          )}
        </Field>
        <Field label="How exact">
          <Select value={values["precision"]} onChange={changePrecision} options={[["DAY", "Exact day"], ["MONTH", "Only the month"], ["YEAR", "Only the year"]]} />
        </Field>
        {report ? (
          <>
            <Field label="Impression" wide hint="The conclusion at the end of the report.">
              <TextArea value={values["impression"]} onChange={set("impression")} rows={3} />
            </Field>
            <Field label="Findings" wide>
              <TextArea value={values["findings"]} onChange={set("findings")} rows={6} />
            </Field>
            <Field label="Short result" hint="Optional, such as BI-RADS 1.">
              <TextInput value={values["value"]} onChange={set("value")} />
            </Field>
            <Field label="Where">
              <TextInput value={values["facility"]} onChange={set("facility")} placeholder="Valley Medical Center" />
            </Field>
            <Field label="Doctor">
              <Select value={values["providerId"]} onChange={set("providerId")} options={payload.state.providers.map((d) => [d.id, d.name] as const)} empty="Not recorded" />
            </Field>
            <Field label="Documents" wide group>
              <FilePicker value={values["fileIds"]} onChange={set("fileIds")} />
            </Field>
          </>
        ) : (
          <Field label={`Value${test.unit === "" ? "" : ` (${test.unit})`}`}>
            <TextInput value={values["value"]} onChange={set("value")} required />
          </Field>
        )}
        <Field label="Note" wide>
          <TextArea value={values["note"]} onChange={set("note")} rows={2} />
        </Field>
      </div>
      <Foot
        error={error}
        busy={busy}
        onCancel={onDone}
        label={result === undefined ? (report ? "Add report" : "Add result") : "Save"}
        onDelete={result === undefined ? undefined : () => confirmDelete(report ? "this report" : "this result") && void submit([del("result", result.id)], "Deleted.")}
      />
    </form>
  );
}

interface SymptomRow {
  name: string;
  bodyArea: string;
  severity: string;
}

/** How she is doing right now. The red-flag check runs as you type. */
export function CheckInForm({ checkIn, onDone }: { readonly checkIn?: CheckIn; readonly onDone: () => void }) {
  const { payload } = useData();
  const { values, set } = useValues({
    at: payload.view.now,
    overall: null,
    energy: null,
    bpSys: "",
    bpDia: "",
    heartRate: "",
    temperatureF: "",
    weightLb: "",
    glucose: "",
    note: "",
    ...checkIn,
  });
  const [symptoms, setSymptoms] = useState<SymptomRow[]>(
    checkIn === undefined || checkIn.symptoms.length === 0
      ? [{ name: "", bodyArea: "", severity: "" }]
      : checkIn.symptoms.map((s) => ({ name: s.name, bodyArea: s.bodyArea, severity: s.severity === null ? "" : String(s.severity) })),
  );
  const { error, busy, submit } = useSubmit(onDone);
  const filled = symptoms.filter((s) => s.name.trim() !== "");
  const flags = useMemo(
    () => messageFlags(payload.state, checkInText({ symptoms: filled.map((s) => ({ name: s.name, bodyArea: s.bodyArea })), note: str(values["note"]) })),
    [payload.state, filled, values],
  );
  const num = (v: unknown) => (str(v) === "" ? null : Number(v));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const data = {
      ...values,
      bpSys: num(values["bpSys"]),
      bpDia: num(values["bpDia"]),
      heartRate: num(values["heartRate"]),
      symptoms: filled.map((s) => ({ name: s.name, bodyArea: s.bodyArea, severity: s.severity === "" ? null : Number(s.severity) })),
    };
    void submit([{ type: "save", collection: "checkIn", id: checkIn?.id ?? null, data }], checkIn === undefined ? "Check-in logged." : "Check-in saved.");
  };
  const setSymptom = (i: number, key: keyof SymptomRow, value: string) => setSymptoms((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid">
        <Field label="When">
          <TextInput type="datetime-local" value={values["at"]} onChange={set("at")} />
        </Field>
        <div />
        <div className="field wide">
          <span className="label">Feeling</span>
          <Scale value={values["overall"] as number | null} onChange={set("overall")} labels={["Very bad", "Bad", "Okay", "Good", "Very good"]} />
        </div>
        <div className="field wide">
          <span className="label">Energy</span>
          <Scale value={values["energy"] as number | null} onChange={set("energy")} labels={["None", "Low", "Some", "Good", "Full"]} />
        </div>
        <div className="field wide">
          <span className="label">Symptoms</span>
          {symptoms.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1.4fr) 110px 36px", gap: 8 }}>
              <input aria-label="Symptom" placeholder="Arm pain" value={row.name} onChange={(e) => setSymptom(i, "name", e.target.value)} />
              <input aria-label="Where" placeholder="Left arm" value={row.bodyArea} onChange={(e) => setSymptom(i, "bodyArea", e.target.value)} />
              <select aria-label="Severity" value={row.severity} onChange={(e) => setSymptom(i, "severity", e.target.value)}>
                <option value="">Severity</option>
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {n} / 10
                  </option>
                ))}
              </select>
              <button type="button" className="btn ghost sm" aria-label="Remove symptom" onClick={() => setSymptoms((rows) => (rows.length === 1 ? [{ name: "", bodyArea: "", severity: "" }] : rows.filter((_, j) => j !== i)))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn ghost sm" onClick={() => setSymptoms((rows) => [...rows, { name: "", bodyArea: "", severity: "" }])}>
              <Icon name="plus" /> Another symptom
            </button>
          </div>
        </div>
        <Field label="Blood pressure" group>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <TextInput type="number" inputMode="numeric" value={values["bpSys"]} onChange={set("bpSys")} />
            <span>/</span>
            <TextInput type="number" inputMode="numeric" value={values["bpDia"]} onChange={set("bpDia")} />
          </div>
        </Field>
        <Field label="Heart rate (beats a minute)">
          <TextInput type="number" inputMode="numeric" value={values["heartRate"]} onChange={set("heartRate")} />
        </Field>
        <Field label="Temperature (°F)">
          <TextInput inputMode="decimal" value={values["temperatureF"]} onChange={set("temperatureF")} />
        </Field>
        <Field label="Weight (lb)">
          <TextInput inputMode="decimal" value={values["weightLb"]} onChange={set("weightLb")} />
        </Field>
        <Field label="Blood sugar (mg/dL)">
          <TextInput inputMode="decimal" value={values["glucose"]} onChange={set("glucose")} />
        </Field>
        <div />
        <Field label="Note" wide>
          <TextArea value={values["note"]} onChange={set("note")} rows={3} />
        </Field>
      </div>
      <FlagBanner flags={flags} />
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={checkIn === undefined ? undefined : () => confirmDelete("this check-in") && void submit([del("checkIn", checkIn.id)], "Check-in deleted.")} label={checkIn === undefined ? "Log check-in" : "Save"} />
    </form>
  );
}

export function QuestionForm({ question, defaults, onDone }: { readonly question?: Question; readonly defaults?: Values; readonly onDone: () => void }) {
  const { payload } = useData();
  const { values, set } = useValues({ text: "", appointmentId: "", relatedIds: [], ...defaults, ...question });
  const { error, busy, submit } = useSubmit(onDone);
  const open = payload.state.appointments.filter((a) => a.status === "SCHEDULED" || a.status === "TO_BOOK");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit([{ type: "save", collection: "question", id: question?.id ?? null, data: { ...values, appointmentId: str(values["appointmentId"]) || null } }], question === undefined ? "Question added." : "Question saved.");
  };
  return (
    <form className="form" onSubmit={onSubmit}>
      <Field label="Question for the doctor">
        <TextArea value={values["text"]} onChange={set("text")} rows={3} placeholder="Could the higher dose explain her tiredness?" />
      </Field>
      <Field label="Ask it at">
        <Select value={values["appointmentId"]} onChange={set("appointmentId")} options={open.map((a) => [a.id, `${a.title}${a.start === null ? " (to book)" : ` · ${a.start.slice(0, 10)}`}`] as const)} empty="Any visit" />
      </Field>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={question === undefined ? undefined : () => confirmDelete("this question") && void submit([del("question", question.id)], "Question deleted.")} />
    </form>
  );
}

/** A small hook for pages: which editor dialog is open. */
export function useEditor<T>() {
  const [editor, setEditor] = useState<T | null>(null);
  return { editor, open: (value: T) => setEditor(value), close: () => setEditor(null) };
}

export { useAction };

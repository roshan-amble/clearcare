import type { Medication } from "@clearcare/domain";
import { useData } from "../data";
import { MedicationForm, Modal, useEditor } from "../forms";
import { relDays, statusLabel } from "../format";
import { Card, Empty, Icon, useHashHighlight } from "../ui";

export function Medications() {
  const { payload } = useData();
  const { state, view } = payload;
  const edit = useEditor<{ medication?: Medication }>();
  useHashHighlight([state.revision]);

  const row = (m: Medication) => {
    const refill = view.refills.find((r) => r.medication.id === m.id);
    return (
      <button type="button" className="row rowbtn" key={m.id} id={m.id} onClick={() => edit.open({ medication: m })}>
        <span className="grow">
          <span className="row-title">
            {m.name} {m.dose}
          </span>
          <span className="row-meta">{[m.instructions, m.asNeeded ? "as needed" : null, m.status === "ACTIVE" ? null : statusLabel(m.status)].filter((x) => x !== null && x !== "").join(" · ")}</span>
        </span>
        {refill === undefined ? null : <span className={`chip ${refill.daysUntil < 0 ? "bad" : "warn"}`}>Refill {relDays(view.today, m.refillDue!)}</span>}
      </button>
    );
  };

  const active = state.medications.filter((m) => m.status === "ACTIVE");
  const other = state.medications.filter((m) => m.status !== "ACTIVE");
  return (
    <>
      <Card
        title="Taking now"
        actions={
          <button type="button" className="btn sm" onClick={() => edit.open({})}>
            <Icon name="plus" /> Add
          </button>
        }
      >
        {active.length === 0 ? <Empty>No medications yet.</Empty> : <div className="list">{active.map(row)}</div>}
      </Card>
      {other.length === 0 ? null : (
        <details className="fold card-fold">
          <summary>Paused and stopped ({other.length})</summary>
          <div className="list">{other.map(row)}</div>
        </details>
      )}
      <Modal open={edit.editor !== null} title={edit.editor?.medication === undefined ? "New medication" : edit.editor.medication.name} onClose={edit.close}>
        <MedicationForm {...(edit.editor?.medication === undefined ? {} : { medication: edit.editor.medication })} onDone={edit.close} />
      </Modal>
    </>
  );
}

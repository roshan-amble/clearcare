import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MEAL_KINDS, dateOf, daysBetween, type Meal } from "@clearcare/domain";
import { WeightChart } from "../charts";
import { useData } from "../data";
import { Field, Modal, useEditor } from "../forms";
import { fmtDate, fmtShort as fmtShortDate, fmtTime, relDays } from "../format";
import { Card, Empty, Icon, useHashHighlight } from "../ui";

const KIND_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack", DRINK: "Drink" };

function useSave(onDone: () => void) {
  const { command, notify } = useData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (cmd: Parameters<typeof command>[0], done: string) => {
    setBusy(true);
    setError(null);
    try {
      await command(cmd);
      notify(done);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, save };
}

function Foot({ error, busy, onCancel, onDelete }: { readonly error: string | null; readonly busy: boolean; readonly onCancel: () => void; readonly onDelete?: () => void }) {
  return (
    <div className="form-foot">
      {error === null ? null : <span className="form-error">{error}</span>}
      {onDelete === undefined ? null : (
        <button type="button" className="btn danger" onClick={onDelete} disabled={busy} style={{ marginRight: "auto" }}>
          <Icon name="trash" /> Delete
        </button>
      )}
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={busy}>
        Save
      </button>
    </div>
  );
}

function WeightForm({ onDone }: { readonly onDone: () => void }) {
  const { payload } = useData();
  const [at, setAt] = useState(payload.view.now);
  const [lb, setLb] = useState("");
  const { error, busy, save } = useSave(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save({ type: "save", collection: "checkIn", data: { at, weightLb: lb } }, "Weight logged.");
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Weight (lb)">
          <input inputMode="decimal" value={lb} onChange={(e) => setLb(e.target.value)} required autoFocus />
        </Field>
        <Field label="When">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} />
    </form>
  );
}

function GoalForm({ onDone }: { readonly onDone: () => void }) {
  const { payload } = useData();
  const diet = payload.state.diet;
  const [goal, setGoal] = useState(diet.goalWeightLb ?? "");
  const [date, setDate] = useState(diet.goalDate ?? "");
  const [plan, setPlan] = useState(diet.plan);
  const { error, busy, save } = useSave(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save({ type: "diet.save", diet: { goalWeightLb: goal, goalDate: date, plan } }, "Goal saved.");
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Goal weight (lb)">
          <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label="By">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Plan" wide>
          <textarea rows={4} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} />
    </form>
  );
}

function MealForm({ meal, onDone }: { readonly meal?: Meal; readonly onDone: () => void }) {
  const { payload } = useData();
  const hour = Number(payload.view.now.slice(11, 13));
  const guess = hour < 11 ? "BREAKFAST" : hour < 15 ? "LUNCH" : hour < 21 ? "DINNER" : "SNACK";
  const [at, setAt] = useState(meal?.at ?? payload.view.now);
  const [kind, setKind] = useState<string>(meal?.kind ?? guess);
  const [description, setDescription] = useState(meal?.description ?? "");
  const [note, setNote] = useState(meal?.note ?? "");
  const { error, busy, save } = useSave(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save({ type: "save", collection: "meal", id: meal?.id ?? null, data: { at, kind, description, note } }, meal === undefined ? "Logged." : "Saved.");
  };
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Meal">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {MEAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="What she ate" wide>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} required autoFocus />
        </Field>
        <Field label="Note" wide>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Foot error={error} busy={busy} onCancel={onDone} onDelete={meal === undefined ? undefined : () => window.confirm("Delete this entry?") && void save({ type: "delete", collection: "meal", id: meal.id }, "Deleted.")} />
    </form>
  );
}

export function Diet() {
  const { payload } = useData();
  const { state, view } = payload;
  const navigate = useNavigate();
  const weight = useEditor<true>();
  const goal = useEditor<true>();
  const meal = useEditor<{ meal?: Meal }>();
  const [showAll, setShowAll] = useState(false);
  useHashHighlight([state.revision]);
  const d = view.diet;
  const goalNumber = d.goal === null ? null : Number(d.goal.lb);
  const change = d.sixMonths ?? d.sinceFirst;

  const meals = state.meals.slice().sort((a, b) => b.at.localeCompare(a.at));
  const shown = showAll ? meals : meals.filter((m) => daysBetween(dateOf(m.at), view.today) <= 14);
  const days = [...new Set(shown.map((m) => dateOf(m.at)))];

  return (
    <>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">Now</span>
          <span className="stat-value">{d.latest === null ? "—" : `${d.latest.lb} lb`}</span>
          <span className="stat-sub">{d.latest === null ? "" : relDays(view.today, dateOf(d.latest.at))}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{d.sixMonths !== null || d.sinceFirst === null ? "Last 6 months" : `Since ${fmtShortDate(dateOf(d.sinceFirst.from.at))}`}</span>
          <span className="stat-value">{change === null ? "—" : `${change.change} lb`}</span>
          <span className="stat-sub">{change === null ? "Log two weights to see the trend" : `${change.perWeek} lb a week`}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Goal</span>
          <span className="stat-value">{d.goal === null ? "—" : `${d.goal.lb} lb`}</span>
          <span className="stat-sub">
            {d.goal === null
              ? ""
              : [d.goal.toGo === null ? null : Number(d.goal.toGo) > 0 ? `${d.goal.toGo} lb to go` : "Reached", d.goal.date === null ? null : `by ${fmtDate(d.goal.date).replace(/^\w+, /, "")}`]
                  .filter((x) => x !== null)
                  .join(" · ")}
          </span>
        </div>
      </div>

      <Card
        title="Weight"
        actions={
          <>
            <button type="button" className="btn sm" onClick={() => goal.open(true)}>
              {d.goal === null ? "Set goal" : "Edit goal"}
            </button>
            <button type="button" className="btn sm primary" onClick={() => weight.open(true)}>
              <Icon name="plus" /> Log weight
            </button>
          </>
        }
      >
        <WeightChart points={d.points} goal={goalNumber !== null && Number.isFinite(goalNumber) ? goalNumber : null} />
        {state.diet.plan === "" ? null : (
          <p className="plan" id="DIET">
            {state.diet.plan}
          </p>
        )}
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => navigate("/", { state: { send: "Suggest a realistic eating plan to help her reach her weight goal, given her conditions, medications and what she has been eating." } })}
        >
          <Icon name="spark" /> Ask for ideas
        </button>
      </Card>

      <Card
        title="Food log"
        actions={
          <button type="button" className="btn sm primary" onClick={() => meal.open({})}>
            <Icon name="plus" /> Log food
          </button>
        }
      >
        {meals.length === 0 ? <Empty>Nothing logged yet.</Empty> : null}
        {days.map((day) => (
          <div key={day} className="food-day">
            <div className="sub-h">{relDays(view.today, day) === "today" ? "Today" : relDays(view.today, day) === "yesterday" ? "Yesterday" : fmtDate(day)}</div>
            {shown
              .filter((m) => dateOf(m.at) === day)
              .map((m) => (
                <button type="button" key={m.id} id={m.id} className="row rowbtn" onClick={() => meal.open({ meal: m })}>
                  <span className="food-kind">{KIND_LABEL[m.kind]}</span>
                  <span className="grow">{m.description}</span>
                  <span className="small muted">{fmtTime(m.at)}</span>
                </button>
              ))}
          </div>
        ))}
        {meals.length > shown.length ? (
          <button type="button" className="btn ghost sm" onClick={() => setShowAll(true)}>
            Show older
          </button>
        ) : null}
      </Card>

      <Modal open={weight.editor !== null} title="Log weight" onClose={weight.close}>
        <WeightForm onDone={weight.close} />
      </Modal>
      <Modal open={goal.editor !== null} title="Weight goal" onClose={goal.close}>
        <GoalForm onDone={goal.close} />
      </Modal>
      <Modal open={meal.editor !== null} title={meal.editor?.meal === undefined ? "Log food" : "Food"} onClose={meal.close}>
        <MealForm {...(meal.editor?.meal === undefined ? {} : { meal: meal.editor.meal })} onDone={meal.close} />
      </Modal>
    </>
  );
}

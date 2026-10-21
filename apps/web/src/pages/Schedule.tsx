import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { addDays, dateOf, type Appointment, type CheckIn, type LocalDate } from "@clearcare/domain";
import { useAction, useData } from "../data";
import { AppointmentForm, CheckInForm, Modal, StatusForm, useEditor } from "../forms";
import { fileLabel, fmtDate, fmtTime } from "../format";
import { Icon } from "../ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
const dayTitle = (d: LocalDate) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** The 42 days shown for a month: from the Sunday on or before the 1st. */
function gridOf(ym: string): LocalDate[] {
  const first = `${ym}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function logSummary(c: CheckIn): string {
  return [
    ...c.symptoms.map((s) => `${s.name}${s.severity === null ? "" : ` ${s.severity}/10`}`),
    c.bpSys === null ? null : `BP ${c.bpSys}/${c.bpDia}`,
    c.heartRate === null ? null : `HR ${c.heartRate}`,
    c.weightLb === null ? null : `${c.weightLb} lb`,
    c.glucose === null ? null : `Sugar ${c.glucose}`,
    c.note === "" ? null : c.note,
  ]
    .filter((x) => x !== null)
    .join(" · ");
}

/** The open questions for one visit, with a box to add another. */
function VisitQuestions({ appointment }: { readonly appointment: Appointment }) {
  const { payload, command } = useData();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const questions = payload.state.questions.filter((q) => q.appointmentId === appointment.id && q.status === "OPEN");
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() === "") return;
    void run(() => command({ type: "save", collection: "question", data: { text, appointmentId: appointment.id } })).then((r) => r !== null && setText(""));
  };
  return (
    <div className="visit-questions">
      <div className="sub-h">Questions to ask</div>
      {questions.map((q) => (
        <label key={q.id} className="check" id={q.id}>
          <input type="checkbox" disabled={busy} onChange={() => void run(() => command({ type: "status", collection: "question", id: q.id, status: "ASKED" }), "Marked as asked.")} />
          {q.text}
        </label>
      ))}
      <form onSubmit={add} className="inline-add">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a question" aria-label="New question" />
        <button type="submit" className="btn sm" disabled={busy || text.trim() === ""}>
          Add
        </button>
      </form>
    </div>
  );
}

/** The uploads a visit came with, such as its visit summary. */
function VisitDocuments({ ids }: { readonly ids: readonly string[] }) {
  const { payload } = useData();
  const files = ids.map((id) => payload.state.files.find((f) => f.id === id)).filter((f) => f !== undefined);
  if (files.length === 0) return null;
  return (
    <div className="visit-questions">
      <div className="sub-h">Documents</div>
      {files.map((f) => (
        <a key={f.id} className="row doc-link" href={`/api/files/${f.id}`} target="_blank" rel="noopener">
          <Icon name="doc" />
          <span className="grow row-title">{fileLabel(f)}</span>
        </a>
      ))}
    </div>
  );
}

export function Schedule() {
  const { payload } = useData();
  const { state, view } = payload;
  const location = useLocation();
  const [month, setMonth] = useState(view.today.slice(0, 7));
  const [selected, setSelected] = useState<LocalDate>(view.today);
  const appt = useEditor<{ appointment?: Appointment; defaults?: Record<string, unknown> }>();
  const done = useEditor<Appointment>();
  const log = useEditor<CheckIn>();

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of state.appointments) {
      if (a.start === null || a.status === "CANCELLED") continue;
      const d = dateOf(a.start);
      map.set(d, [...(map.get(d) ?? []), a].sort((x, y) => x.start!.localeCompare(y.start!)));
    }
    return map;
  }, [state.appointments]);
  const logsByDay = useMemo(() => {
    const map = new Map<string, CheckIn[]>();
    for (const c of state.checkIns) map.set(dateOf(c.at), [...(map.get(dateOf(c.at)) ?? []), c].sort((x, y) => x.at.localeCompare(y.at)));
    return map;
  }, [state.checkIns]);

  // A link to a visit or a log opens its day.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    const a = state.appointments.find((x) => x.id === id);
    const c = state.checkIns.find((x) => x.id === id);
    const q = state.questions.find((x) => x.id === id);
    const target = a?.start ?? c?.at ?? (q?.appointmentId === null || q === undefined ? null : state.appointments.find((x) => x.id === q.appointmentId)?.start ?? null);
    if (target !== null && target !== undefined) {
      setSelected(dateOf(target));
      setMonth(target.slice(0, 7));
    }
    if (a !== undefined) appt.open({ appointment: a });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  const days = gridOf(month);
  const dayAppointments = byDay.get(selected) ?? [];
  const dayLogs = logsByDay.get(selected) ?? [];
  const toBook = state.appointments.filter((a) => a.status === "TO_BOOK");
  const goToday = () => {
    setMonth(view.today.slice(0, 7));
    setSelected(view.today);
  };

  return (
    <div className="calendar-page">
      <div className="cal-head">
        <h2>
          {monthName(month)} <span className="muted">{month.slice(0, 4)}</span>
        </h2>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <Icon name="chevl" />
          </button>
          <button type="button" className="btn sm" onClick={goToday}>
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <Icon name="chevr" />
          </button>
        </div>
        <button type="button" className="btn sm primary" onClick={() => appt.open({ defaults: { start: `${selected}T09:00` } })}>
          <Icon name="plus" /> Add appointment
        </button>
      </div>

      <div className="cal-grid" role="grid" aria-label={`${monthName(month)} ${month.slice(0, 4)}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const events = byDay.get(d) ?? [];
          const logs = logsByDay.get(d) ?? [];
          const classes = ["cal-day", d.slice(0, 7) === month ? "" : "other", d === view.today ? "today" : "", d === selected ? "selected" : "", d < view.today ? "past" : ""].join(" ");
          return (
            <button type="button" key={d} className={classes} onClick={() => setSelected(d)} aria-label={`${dayTitle(d)}${events.length === 0 ? "" : `, ${events.length} appointment${events.length === 1 ? "" : "s"}`}`}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              <span className="cal-events">
                {events.slice(0, 2).map((a) => (
                  <span key={a.id} className={`cal-event ${a.status === "COMPLETED" ? "done" : ""}`}>
                    <span className="cal-time">{fmtTime(a.start!)}</span> {a.title}
                  </span>
                ))}
                {events.length > 2 ? <span className="cal-more">+{events.length - 2} more</span> : null}
              </span>
              <span className="cal-dots">
                {events.map((a) => (
                  <i key={a.id} className="dot-appt" />
                ))}
                {logs.length > 0 ? <i className="dot-log" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <section className="day-panel" aria-label={dayTitle(selected)}>
        <h3>{dayTitle(selected)}</h3>
        {dayAppointments.length === 0 && dayLogs.length === 0 ? <p className="muted small">Nothing scheduled.</p> : null}
        {dayAppointments.map((a) => {
          const doctor = a.providerId === null ? null : state.providers.find((p) => p.id === a.providerId)?.name ?? null;
          const needsNotes = a.status === "SCHEDULED" && a.start! < view.now;
          return (
            <button type="button" key={a.id} id={a.id} className="day-event" onClick={() => appt.open({ appointment: a })}>
              <span className="day-time">{fmtTime(a.start!)}</span>
              <span className="grow">
                <span className="row-title">{a.title}</span>
                <span className="row-meta">{[doctor, a.location || null].filter((x) => x !== null).join(" · ")}</span>
              </span>
              {a.status === "COMPLETED" ? <span className="chip ok">Done</span> : needsNotes ? <span className="chip warn">How did it go?</span> : null}
            </button>
          );
        })}
        {dayLogs.map((c) => (
          <button type="button" key={c.id} id={c.id} className="day-event log" onClick={() => log.open(c)}>
            <span className="day-time">{fmtTime(c.at)}</span>
            <span className="grow">
              <span className="row-meta">Logged · {logSummary(c)}</span>
            </span>
          </button>
        ))}
      </section>

      {toBook.length === 0 ? null : (
        <section className="day-panel">
          <h3>Not booked yet</h3>
          {toBook.map((a) => (
            <button type="button" key={a.id} id={a.id} className="day-event" onClick={() => appt.open({ appointment: a })}>
              <span className="day-time">{a.bookBy === null ? "" : `by ${fmtDate(a.bookBy).replace(/^\w+, /, "").replace(/, \d{4}$/, "")}`}</span>
              <span className="grow">
                <span className="row-title">{a.title}</span>
              </span>
            </button>
          ))}
        </section>
      )}

      <Modal open={appt.editor !== null} title={appt.editor?.appointment === undefined ? "New appointment" : appt.editor.appointment.title} onClose={appt.close}>
        {appt.editor?.appointment !== undefined && appt.editor.appointment.status === "SCHEDULED" && appt.editor.appointment.start! < view.now ? (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => {
                const a = appt.editor!.appointment!;
                appt.close();
                done.open(a);
              }}
            >
              <Icon name="check" /> Mark as done
            </button>
          </div>
        ) : null}
        <AppointmentForm {...(appt.editor?.appointment === undefined ? {} : { appointment: appt.editor.appointment })} {...(appt.editor?.defaults === undefined ? {} : { defaults: appt.editor.defaults })} onDone={appt.close} />
        {appt.editor?.appointment === undefined || appt.editor.appointment.status === "CANCELLED" || appt.editor.appointment.status === "COMPLETED" ? null : (
          <VisitQuestions appointment={appt.editor.appointment} />
        )}
        {appt.editor?.appointment === undefined ? null : <VisitDocuments ids={appt.editor.appointment.fileIds ?? []} />}
      </Modal>
      <Modal open={done.editor !== null} title="How did the visit go?" onClose={done.close}>
        {done.editor === null ? null : <StatusForm collection="appointment" id={done.editor.id} current={done.editor.status} next="COMPLETED" outcome={done.editor.outcome} onDone={done.close} />}
      </Modal>
      <Modal open={log.editor !== null} title="Logged" onClose={log.close}>
        {log.editor === null ? null : <CheckInForm checkIn={log.editor} onDone={log.close} />}
      </Modal>
    </div>
  );
}

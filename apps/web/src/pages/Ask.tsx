import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  CHANGE_FIELDS,
  chatChanges,
  messageFlags,
  STATUS_COLLECTIONS,
  type AiRun,
  type ChangeProposal,
  type ChatOutput,
  type FieldSpec,
  type HealthState,
  type Likelihood,
  type ProposalCheck,
  type ProposalDecision,
} from "@clearcare/domain";
import { useData } from "../data";
import { fmtDate, fmtDateTime, fmtPartialDate, recordLabel, statusLabel, URGENCY } from "../format";
import { FlagBanner, Icon, RecordLink } from "../ui";

/** Plain text with blank-line paragraphs and "- " lists, as the model is asked to write. */
export function Prose({ text }: { readonly text: string }) {
  const out: ReactNode[] = [];
  text.split(/\n\s*\n/).forEach((block, b) => {
    let items: string[] = [];
    let para: string[] = [];
    const flush = (key: string) => {
      if (para.length > 0) out.push(<p key={`p${key}`}>{para.join(" ")}</p>);
      if (items.length > 0) out.push(<ul key={`u${key}`}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>);
      para = [];
      items = [];
    };
    block.split("\n").forEach((line, l) => {
      const t = line.trim();
      if (t.startsWith("- ")) {
        if (para.length > 0) flush(`${b}-${l}`);
        items.push(t.slice(2));
      } else if (t !== "") {
        if (items.length > 0) flush(`${b}-${l}`);
        para.push(t);
      }
    });
    flush(`${b}-end`);
  });
  return <div className="prose">{out}</div>;
}

// ---------------------------------------------------------------------------------------------------------------
// A proposed change to the record.

const ARRAYS = {
  appointment: "appointments",
  medication: "medications",
  diagnosis: "diagnoses",
  test: "tests",
  result: "results",
  checkIn: "checkIns",
  question: "questions",
  provider: "providers",
} as const;

const ICON: Record<string, string> = { appointment: "calendar", medication: "pill", diagnosis: "flask", test: "flask", result: "flask", checkIn: "heart", question: "note", provider: "user", profile: "user" };

function recordOf(state: HealthState, collection: string, id: string | null): Record<string, unknown> | null {
  if (collection === "profile") return state.profile as unknown as Record<string, unknown>;
  if (id === null || !(collection in ARRAYS)) return null;
  const list = state[ARRAYS[collection as keyof typeof ARRAYS]] as readonly { readonly id: string }[];
  return (list.find((r) => r.id === id) as unknown as Record<string, unknown> | undefined) ?? null;
}

/** A record ID, or "#N" for what the answer's Nth change adds. */
function nameOf(state: HealthState, id: string, siblings: readonly ChangeProposal[]): string {
  const match = /^#(\d+)$/.exec(id.trim());
  if (match === null) return recordLabel(state, id);
  const sibling = siblings[Number(match[1]) - 1];
  return sibling === undefined ? "a new record" : `new: ${sibling.summary}`;
}

function show(state: HealthState, spec: FieldSpec | undefined, value: unknown, siblings: readonly ChangeProposal[] = []): string {
  if (value === null || value === undefined || value === "") return "none";
  if (spec === undefined) return String(value);
  switch (spec.type) {
    case "ref":
      return nameOf(state, String(value), siblings);
    case "ids":
      return (value as string[]).map((id) => nameOf(state, id, siblings)).join(", ") || "none";
    case "list":
      return (value as string[]).join(", ") || "none";
    case "date":
      return fmtDate(String(value));
    case "partialdate":
      return fmtPartialDate(String(value));
    case "longtext": {
      const text = String(value);
      return text.length > 360 ? `${text.slice(0, 360).trimEnd()}…` : text;
    }
    case "datetime":
      return fmtDateTime(String(value));
    case "bool":
      return value === true ? "Yes" : "No";
    case "enum":
      return statusLabel(String(value)) === String(value) ? String(value).charAt(0) + String(value).slice(1).toLowerCase().replace(/_/g, " ") : statusLabel(String(value));
    case "symptoms":
      return (value as { name: string; bodyArea: string; severity: number | null }[])
        .map((s) => `${s.name}${s.bodyArea === "" ? "" : ` (${s.bodyArea})`}${s.severity === null ? "" : ` ${s.severity}/10`}`)
        .join("; ");
    default:
      return String(value);
  }
}

interface Row {
  readonly key: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string;
  readonly spec?: FieldSpec;
}

function rowsOf(state: HealthState, change: ChangeProposal, edits: Record<string, unknown>, siblings: readonly ChangeProposal[]): Row[] {
  if (change.kind === "DELETE") return [];
  const before = recordOf(state, change.collection, change.id);
  if (change.kind === "STATUS") {
    const rows: Row[] = [{ key: "status", label: "Status", before: before === null ? null : statusLabel(String(before["status"])), after: statusLabel(String(edits["status"] ?? change.status)) }];
    const at = (edits["at"] as string | undefined) ?? change.at;
    if (at !== null) rows.push({ key: "at", label: "When", before: null, after: fmtDate(at) });
    const note = (edits["note"] as string | undefined) ?? change.note;
    if (note !== "") rows.push({ key: "note", label: "Note", before: null, after: note });
    if (change.outcome !== null) rows.push({ key: "outcome", label: "Visit notes", before: null, after: change.outcome });
    if (change.answer !== null) rows.push({ key: "answer", label: "Answer", before: null, after: change.answer });
    return rows;
  }
  const rows: Row[] = [];
  const creating = change.id === null && change.collection !== "profile";
  const given = (key: string) => (key in edits ? edits[key] : change.fields[key]);
  for (const spec of CHANGE_FIELDS[change.collection]) {
    const value = given(spec.key);
    if (value === null || value === undefined) continue;
    // Leave out what goes without saying on a new record.
    if (spec.key === "asNeeded" && value === false) continue;
    if (spec.key === "timesPerDay" && typeof given("instructions") === "string" && given("instructions") !== "") continue;
    if (creating && spec.key === "status" && ["ACTIVE", "OPEN", "SCHEDULED", "TO_BOOK"].includes(String(value))) continue;
    if (creating && spec.key === "kind" && value === "LAB") continue;
    let old: unknown = before?.[spec.key];
    if (change.collection === "test" && spec.key === "frequencyEvery") old = (before?.["frequency"] as { every: number } | null)?.every;
    if (change.collection === "test" && spec.key === "frequencyUnit") old = (before?.["frequency"] as { unit: string } | null)?.unit;
    rows.push({ key: spec.key, label: spec.label, before: change.id === null && change.collection !== "profile" ? null : show(state, spec, old), after: show(state, spec, value, siblings), spec });
  }
  return rows;
}

function FieldInput({ spec, value, onChange }: { readonly spec: FieldSpec; readonly value: unknown; readonly onChange: (v: unknown) => void }) {
  const { payload } = useData();
  const str = value === null || value === undefined ? "" : String(value);
  switch (spec.type) {
    case "longtext":
      return <textarea rows={2} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
    case "datetime":
      return <input type="datetime-local" value={str} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
    case "int":
      return <input type="number" inputMode="numeric" value={str} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "bool":
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "enum":
      return (
        <select value={str} onChange={(e) => onChange(e.target.value)}>
          {(spec.options ?? []).map((o) => (
            <option key={o} value={o}>
              {statusLabel(o) === o ? o.charAt(0) + o.slice(1).toLowerCase() : statusLabel(o)}
            </option>
          ))}
        </select>
      );
    case "ref": {
      const records = spec.refs === undefined || !(spec.refs in ARRAYS) ? [] : (payload.state[ARRAYS[spec.refs as keyof typeof ARRAYS]] as readonly { readonly id: string }[]);
      return (
        <select value={str} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
          <option value="">None</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {recordLabel(payload.state, r.id)}
            </option>
          ))}
        </select>
      );
    }
    case "ids":
    case "list":
    case "symptoms":
      return <span className="muted">{show(payload.state, spec, value)}</span>;
    default:
      return <input value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

function ChangeCard(props: {
  readonly run: AiRun;
  readonly index: number;
  readonly change: ChangeProposal;
  readonly siblings: readonly ChangeProposal[];
  readonly check: ProposalCheck;
  readonly decision: ProposalDecision | undefined;
  readonly busy: boolean;
  readonly onDecide: (index: number, choice: "ACCEPT" | "DISMISS", edits: Record<string, unknown>) => void;
}) {
  const { payload } = useData();
  const { change, check, decision } = props;
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const rows = rowsOf(payload.state, change, edits, props.siblings);
  const target = decision?.createdIds[0] ?? (change.kind === "DELETE" ? null : change.id);
  const statusOptions =
    change.kind === "STATUS" && (STATUS_COLLECTIONS as readonly string[]).includes(change.collection)
      ? { key: "status", label: "Status", type: "enum" as const, options: { appointment: ["TO_BOOK", "SCHEDULED", "COMPLETED", "CANCELLED"], medication: ["ACTIVE", "PAUSED", "STOPPED"], diagnosis: ["ACTIVE", "MONITORING", "MANAGED", "RESOLVED"], test: ["ACTIVE", "PAUSED", "STOPPED"], question: ["OPEN", "ASKED", "DROPPED"] }[change.collection] }
      : null;
  return (
    <div className={`change ${decision !== undefined ? "done" : ""} ${check.ok ? "" : "refused"}`}>
      <div className="change-h">
        <Icon name={ICON[change.collection] ?? "note"} />
        <span className="change-title">{change.summary}</span>
        {decision === undefined ? null : <span className={`chip ${decision.decision === "ACCEPTED" ? "ok" : ""}`}>{decision.decision === "ACCEPTED" ? "Applied" : "Skipped"}</span>}
      </div>
      {change.kind === "DELETE" ? <div className="small">Removes {recordLabel(payload.state, change.id)}</div> : null}
      {rows.length === 0 || editing || decision !== undefined ? null : (
        <dl className="change-rows">
          {rows.map((r) => (
            <div key={r.key}>
              <dt>{r.label}</dt>
              <dd>
                {r.before !== null && r.before !== "none" && r.before !== r.after ? (
                  <>
                    <s className="muted">{r.before}</s> {r.after}
                  </>
                ) : (
                  r.after
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {editing && decision === undefined ? (
        <div className="change-edit">
          {change.kind === "SAVE"
            ? rows
                .filter((r) => r.spec !== undefined)
                .map((r) => (
                  <label key={r.key} className="field">
                    <span className="label">{r.label}</span>
                    <FieldInput spec={r.spec!} value={r.key in edits ? edits[r.key] : change.fields[r.key]} onChange={(v) => setEdits((e) => ({ ...e, [r.key]: v }))} />
                  </label>
                ))
            : null}
          {change.kind === "STATUS" && statusOptions !== null ? (
            <>
              <label className="field">
                <span className="label">Status</span>
                <FieldInput spec={statusOptions} value={edits["status"] ?? change.status} onChange={(v) => setEdits((e) => ({ ...e, status: v }))} />
              </label>
              <label className="field">
                <span className="label">Note</span>
                <input value={String(edits["note"] ?? change.note)} onChange={(e) => setEdits((x) => ({ ...x, note: e.target.value }))} />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
      {!check.ok ? <div className="small refused-why">Can't apply: {check.reasons.join(" ")}</div> : null}
      {decision === undefined && check.ok ? (
        <div className="change-actions">
          <button type="button" className="btn sm primary" disabled={props.busy} onClick={() => props.onDecide(props.index, "ACCEPT", edits)}>
            <Icon name="check" /> Apply
          </button>
          {change.kind === "DELETE" ? null : (
            <button type="button" className="btn sm" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button type="button" className="btn sm ghost" disabled={props.busy} onClick={() => props.onDecide(props.index, "DISMISS", {})}>
            Skip
          </button>
        </div>
      ) : null}
      {decision?.decision === "ACCEPTED" && target !== null && change.kind !== "DELETE" && change.collection !== "profile" ? (
        <div className="small">
          <RecordLink id={target} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const LIKELIHOOD: Record<Likelihood, string> = { LIKELY: "likely", POSSIBLE: "possible", UNLIKELY: "unlikely" };

function AnswerCard({ run, canRetry, onRetry, onFollowUp }: { readonly run: AiRun | undefined; readonly canRetry: boolean; readonly onRetry: () => void; readonly onFollowUp: (q: string) => void }) {
  const { payload, post, notify } = useData();
  const [busy, setBusy] = useState(false);
  if (run === undefined) return null;
  if (run.status !== "SUCCEEDED") {
    return (
      <div className="answer failed">
        <p>{run.status === "INVALID" ? "The answer didn't pass ClearCare's checks, so it isn't shown." : "No answer this time."}</p>
        {run.floor === "EMERGENCY" ? <p><b>The warning signs in your message mean: call 911 if they are happening now.</b></p> : null}
        <details>
          <summary>Details</summary>
          <ul className="small">
            {run.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
        {canRetry ? (
          <button type="button" className="btn sm" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  const o = run.output as ChatOutput;
  const changes = chatChanges(o, payload.view.today);
  const pending = changes.map((c, i) => ({ ...c, index: i })).filter((c) => c.check.ok && !run.decisions.some((d) => d.index === c.index));
  const decide = async (index: number, choice: "ACCEPT" | "DISMISS", edits: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post("/api/decide", { runId: run.id, index, decision: choice, edits });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const applyAll = async () => {
    setBusy(true);
    try {
      for (const c of pending) await post("/api/decide", { runId: run.id, index: c.index, decision: "ACCEPT", edits: {} });
      notify(`Applied ${pending.length} changes.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const urgent = o.urgency === "EMERGENCY" || o.urgency === "TODAY" || o.urgency === "SOON";
  const whose = payload.viewer.role === "PATIENT" ? "your" : "her";
  return (
    <div className="answer">
      {urgent ? (
        <div className={`urgency ${o.urgency}`}>
          <Icon name={URGENCY[o.urgency].icon} size={16} /> {URGENCY[o.urgency].label}
        </div>
      ) : null}
      <div className="answer-body">
        <p className="headline">{o.headline}</p>
        {o.answer.trim() === o.headline.trim() ? null : <Prose text={o.answer} />}
        {o.connections.length + o.otherPossibilities.length === 0 ? null : (
          <details className="why">
            <summary>How this connects to {whose} record</summary>
            <ul>
              {o.connections.map((c, i) => (
                <li key={i}>
                  <span className={`dot ${c.likelihood}`} title={LIKELIHOOD[c.likelihood]} /> <RecordLink id={c.recordId} />
                  <span className="muted"> · {LIKELIHOOD[c.likelihood]}</span>
                  <div>{c.explanation}</div>
                </li>
              ))}
            </ul>
            {o.otherPossibilities.length === 0 ? null : (
              <>
                <div className="sub-h">Other possible causes</div>
                <ul className="plain">
                  {o.otherPossibilities.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </details>
        )}
        {o.followUpQuestions.length === 0 ? null : (
          <div className="followups">
            {o.followUpQuestions.map((q, i) => (
              <button key={i} type="button" className="starter" title="Answer this" onClick={() => onFollowUp(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {changes.length === 0 ? null : (
          <div className="changes">
            {pending.length > 1 ? (
              <div className="changes-h">
                <button type="button" className="btn sm primary" disabled={busy} onClick={() => void applyAll()}>
                  <Icon name="check" /> Apply all {pending.length}
                </button>
              </div>
            ) : null}
            {changes.map((c, i) => (
              <ChangeCard key={i} run={run} index={i} change={c.change} siblings={changes.map((x) => x.change)} check={c.check} decision={run.decisions.find((d) => d.index === i)} busy={busy} onDecide={(idx, choice, edits) => void decide(idx, choice, edits)} />
            ))}
          </div>
        )}
        {run.warnings.length === 0 ? null : <p className="small muted">{run.warnings.join(" ")}</p>}
      </div>
    </div>
  );
}

export function Ask() {
  const { threadId } = useParams();
  const { payload, post, notify } = useData();
  const { state, ai } = payload;
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = location.state as { draft?: string; send?: string } | null;
  const [draft, setDraft] = useState<string>(() => incoming?.draft ?? "");
  const [pending, setPending] = useState<{ readonly text: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sentFromElsewhere = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = threadId === undefined ? undefined : state.threads.find((t) => t.id === threadId);
  const flags = useMemo(() => messageFlags(state, draft), [state, draft]);
  const threads = state.threads.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const messages = thread?.messages ?? [];
  const empty = messages.length === 0 && pending === null;
  const lastIndex = messages.length - 1;

  const send = async (text: string) => {
    const message = text.trim();
    if (message === "" || pending !== null) return;
    setPending({ text: message });
    setDraft("");
    try {
      const next = await post("/api/chat", { threadId: thread?.id ?? null, text: message });
      if (thread === undefined && next.threadId !== undefined) navigate(`/chat/${next.threadId}`, { replace: true });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      setDraft(message);
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    if (incoming?.send !== undefined && !sentFromElsewhere.current) {
      sentFromElsewhere.current = true;
      void send(incoming.send);
    }
    if (incoming !== null) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!empty) bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, empty]);
  useEffect(() => {
    // Grow the box with what is typed, up to a limit.
    const el = input.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const retry = async () => {
    if (thread === undefined) return;
    setPending({ text: null });
    try {
      await post("/api/chat/retry", { threadId: thread.id });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setPending(null);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const composer = (
    <div className="composer2">
      <FlagBanner flags={flags} />
      {ai.available ? null : <p className="small muted center">{ai.note}</p>}
      <div className="composer-pill">
        <textarea ref={input} aria-label="Message" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <button type="button" className="send-btn" aria-label="Send" disabled={draft.trim() === "" || pending !== null || !ai.available} onClick={() => void send(draft)}>
          <Icon name="up" size={18} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`chat2 ${empty ? "is-empty" : ""}`}>
      <div className="chat-tools">
        <button type="button" className="icon-btn" title="New chat" aria-label="New chat" onClick={() => navigate("/")}>
          <Icon name="edit" />
        </button>
        {threads.length === 0 ? null : (
          <div className="history-wrap">
            <button type="button" className="icon-btn" title="Past chats" aria-label="Past chats" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)}>
              <Icon name="history" />
            </button>
            {historyOpen ? (
              <div className="history-pop" role="menu">
                {threads.map((t) => (
                  <Link key={t.id} to={`/chat/${t.id}`} className={t.id === threadId ? "active" : ""} onClick={() => setHistoryOpen(false)} role="menuitem">
                    <span>{t.title}</span>
                    <span className="small muted">{fmtDateTime(t.createdAt)}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {empty ? (
        <div className="hero">
          <h1>What's going on?</h1>
          {composer}
        </div>
      ) : (
        <>
          <div className="thread">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="msg-user-wrap">
                  {m.by === undefined || m.by === payload.viewer.name ? null : <span className="small muted">{m.by}</span>}
                  <div className="msg-user">{m.text}</div>
                </div>
              ) : (
                <AnswerCard
                  key={m.id}
                  run={state.aiRuns.find((r) => r.id === m.runId)}
                  canRetry={i === lastIndex && pending === null}
                  onRetry={() => void retry()}
                  onFollowUp={(q) => {
                    setDraft((d) => `${d}${d === "" ? "" : "\n"}${q} `);
                    input.current?.focus();
                  }}
                />
              ),
            )}
            {pending === null ? null : (
              <>
                {pending.text === null ? null : (
                  <div className="msg-user-wrap">
                    <div className="msg-user">{pending.text}</div>
                  </div>
                )}
                <div className="thinking" aria-live="polite">
                  <span />
                  <span />
                  <span />
                </div>
              </>
            )}
            <div ref={bottom} />
          </div>
          <div className="dock">{composer}</div>
        </>
      )}
    </div>
  );
}

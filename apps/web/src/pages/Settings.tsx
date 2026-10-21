import { useState } from "react";
import type { Person, Provider, Role } from "@clearcare/domain";
import { useAction, useData } from "../data";
import { Modal, ProviderForm, useEditor } from "../forms";
import { fmtDateTime, money, thousands } from "../format";
import { Card, Empty, Icon, useHashHighlight } from "../ui";

const ROLE_LABEL: Record<Role, string> = { CAREGIVER: "Family", PATIENT: "Patient (her)" };

type Theme = "system" | "light" | "dark";
const readTheme = (): Theme => {
  const t = document.documentElement.dataset["theme"];
  return t === "light" || t === "dark" ? t : "system";
};
function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = theme;
  try {
    if (theme === "system") localStorage.removeItem("clearcare-theme");
    else localStorage.setItem("clearcare-theme", theme);
  } catch {
    // Storage can be unavailable; the theme still applies for this visit.
  }
}

function People() {
  const { payload, command } = useData();
  const { busy, run } = useAction();
  const [rows, setRows] = useState<Person[]>(payload.state.people.map((p) => ({ ...p })));
  const editable = payload.viewer.local;
  const set = (i: number, patch: Partial<Person>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const listed = new Set(rows.map((r) => r.login.toLowerCase()));
  const waiting = payload.refusedLogins.filter((r) => !listed.has(r.login));
  return (
    <Card title="Who can use ClearCare" sub="Tailscale logins">
      {!editable ? (
        <div className="list">
          {payload.state.people.map((p) => (
            <div className="row" key={p.login}>
              <span className="grow">{p.name}</span>
              <span className="muted">{ROLE_LABEL[p.role]}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="form">
          {rows.map((row, i) => (
            <div key={i} className="people-row">
              <input aria-label="Tailscale login" placeholder="name@gmail.com" value={row.login} onChange={(e) => set(i, { login: e.target.value })} />
              <input aria-label="Name" placeholder="Name" value={row.name} onChange={(e) => set(i, { name: e.target.value })} />
              <select aria-label="Role" value={row.role} onChange={(e) => set(i, { role: e.target.value as Role })}>
                <option value="CAREGIVER">{ROLE_LABEL.CAREGIVER}</option>
                <option value="PATIENT">{ROLE_LABEL.PATIENT}</option>
              </select>
              <button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          {waiting.length === 0 ? null : (
            <div className="waiting">
              <span className="small muted">Tried to sign in:</span>
              {waiting.map((r) => (
                <button key={r.login} type="button" className="btn sm" title={fmtDateTime(r.at)} onClick={() => setRows((rs) => [...rs, { login: r.login, name: "", role: "PATIENT" }])}>
                  <Icon name="plus" /> {r.login}
                </button>
              ))}
            </div>
          )}
          <div className="form-foot">
            <button type="button" className="btn" onClick={() => setRows((r) => [...r, { login: "", name: "", role: "CAREGIVER" }])}>
              <Icon name="plus" /> Add person
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => command({ type: "people.save", people: rows }), "Saved.")}>
              Save
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Settings() {
  const { payload, post } = useData();
  const { state, ai, viewer } = payload;
  const [theme, setTheme] = useState<Theme>(readTheme());
  const doctor = useEditor<{ provider?: Provider }>();
  const { busy, run } = useAction();
  useHashHighlight([state.revision]);
  const runs = state.aiRuns.slice().reverse();
  const emptyRecord = [state.medications, state.diagnoses, state.appointments, state.tests, state.results, state.checkIns, state.providers].every((l) => l.length === 0);
  const totalCost = state.aiRuns.reduce((sum, r) => sum + (r.usage.costUsd ?? 0), 0);

  return (
    <>
      <People />

      <Card
        title="Doctors"
        actions={
          <button type="button" className="btn sm" onClick={() => doctor.open({})}>
            <Icon name="plus" /> Add
          </button>
        }
      >
        {state.providers.length === 0 ? <Empty>No doctors yet.</Empty> : null}
        <div className="list">
          {state.providers.map((p) => (
            <button type="button" className="row rowbtn" key={p.id} id={p.id} onClick={() => doctor.open({ provider: p })}>
              <span className="grow">
                <span className="row-title">{p.name}</span>
                <span className="row-meta">{[p.specialty, p.phone].filter((x) => x !== "").join(" · ")}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Appearance">
        <div className="seg" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => {
                applyTheme(t);
                setTheme(t);
              }}
            >
              {t === "system" ? "Automatic" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Data">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <a className="btn sm" href="/api/export">
            <Icon name="download" /> Download a copy
          </a>
          {!state.profile.sample && viewer.local && emptyRecord ? (
            <button type="button" className="btn sm" disabled={busy} onClick={() => void run(() => post("/api/sample", { action: "load" }), "Sample patient loaded.")}>
              Load a fictional sample patient
            </button>
          ) : null}
          {state.profile.sample && viewer.local ? (
            <button
              type="button"
              className="btn sm danger"
              disabled={busy}
              onClick={() => window.confirm("Clear the sample patient and start an empty record?") && void run(() => post("/api/sample", { action: "clear" }), "Sample cleared.")}
            >
              Clear the sample
            </button>
          ) : null}
        </div>
        {payload.dataFile === null ? null : <p className="small muted">Saved in {payload.dataFile}, with a daily backup.</p>}
      </Card>

      <details className="fold card-fold">
        <summary>AI usage</summary>
        <p className="small muted">
          {ai.available ? `${ai.description}, effort ${ai.chatEffort}.` : ai.note} {runs.length} answers{totalCost > 0 ? `, about ${money(totalCost)} at list price` : ""}.
        </p>
        {runs.length === 0 ? null : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Outcome</th>
                  <th>Tokens in / out</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} title={r.id}>
                    <td className="small nowrap">{fmtDateTime(r.startedAt)}</td>
                    <td className="small">{r.job === "CHAT" ? "Chat" : "Document"}</td>
                    <td className="small">{r.status === "SUCCEEDED" ? "OK" : <span title={r.reasons.join(" ")}>{r.status.toLowerCase()}</span>}</td>
                    <td className="num small nowrap">
                      {thousands(r.usage.inputTokens)} / {thousands(r.usage.outputTokens)}
                    </td>
                    <td className="num small">{Math.round(r.durationMs / 1000)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <Modal open={doctor.editor !== null} title={doctor.editor?.provider === undefined ? "New doctor" : doctor.editor.provider.name} onClose={doctor.close}>
        <ProviderForm {...(doctor.editor?.provider === undefined ? {} : { provider: doctor.editor.provider })} onDone={doctor.close} />
      </Modal>
    </>
  );
}

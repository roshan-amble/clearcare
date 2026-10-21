import { Fragment, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { isReportTest, rangeText, resultFlag, type Diagnosis, type Result, type Test } from "@clearcare/domain";
import { Sparkline } from "../charts";
import { useAction, useData } from "../data";
import { DiagnosisForm, Modal, ResultForm, TestForm, useEditor } from "../forms";
import { fileLabel, fmtPlain, fmtResultDate, KIND_LABEL, recordLabel, relDays } from "../format";
import { AiChip, Card, Empty, Icon, StatusChip, useHashHighlight } from "../ui";

function FlagChip({ flag }: { readonly flag: string | null }) {
  if (flag === "HIGH") return <span className="chip bad">▲ High</span>;
  if (flag === "LOW") return <span className="chip bad">▼ Low</span>;
  return null;
}

/** A whole report: what it concluded, what it found, and the documents it came in. */
function ReportView({ test, result, onEdit }: { readonly test: Test; readonly result: Result; readonly onEdit: () => void }) {
  const { payload } = useData();
  const files = (result.fileIds ?? []).map((id) => payload.state.files.find((f) => f.id === id)).filter((f) => f !== undefined);
  const doctor = result.providerId ? recordLabel(payload.state, result.providerId) : "";
  return (
    <div className="report-view">
      <div className="small muted">
        {[KIND_LABEL[test.kind], result.facility, doctor].filter((x) => x !== undefined && x !== "").join(" · ")}
        {result.source === "AI" ? <> {" "}<AiChip runId={result.aiRunId} /></> : null}
      </div>
      {result.value === "" ? null : (
        <p>
          <b>{result.value}</b>
        </p>
      )}
      {result.impression ? (
        <section>
          <div className="sub-h">Impression</div>
          <p className="pre">{result.impression}</p>
        </section>
      ) : null}
      {result.findings ? (
        <section>
          <div className="sub-h">Findings</div>
          <p className="pre">{result.findings}</p>
        </section>
      ) : null}
      {result.note ? (
        <section>
          <div className="sub-h">Note</div>
          <p className="pre">{result.note}</p>
        </section>
      ) : null}
      {files.length === 0 ? null : (
        <section>
          <div className="sub-h">Documents</div>
          <div className="list">
            {files.map((f) => (
              <a key={f.id} className="row doc-link" href={`/api/files/${f.id}`} target="_blank" rel="noopener">
                <Icon name="doc" />
                <span className="grow row-title">{fileLabel(f)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <div className="form-foot">
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="edit" /> Edit
        </button>
      </div>
    </div>
  );
}

export function Conditions() {
  const { payload, command } = useData();
  const { state, view } = payload;
  const location = useLocation();
  const dx = useEditor<{ diagnosis?: Diagnosis }>();
  const test = useEditor<{ test?: Test; kind?: string }>();
  const result = useEditor<Test>();
  const edit = useEditor<{ test: Test; result: Result }>();
  const view_ = useEditor<{ test: Test; result: Result }>();
  const labs = view.tests.filter((s) => !isReportTest(s.test));
  const reports = view.tests.filter((s) => isReportTest(s.test));
  const [openTest, setOpenTest] = useState<string | null>(null);
  const { run } = useAction();

  // A link to a result or a test opens that test's results.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id.startsWith("RES-")) setOpenTest(state.results.find((r) => r.id === id)?.testId ?? null);
    if (id.startsWith("TST-")) setOpenTest(id);
  }, [location.hash, state.results]);
  useHashHighlight([state.revision, openTest]);

  return (
    <>
      <Card
        title="Conditions"
        actions={
          <button type="button" className="btn sm" onClick={() => dx.open({})}>
            <Icon name="plus" /> Add
          </button>
        }
      >
        {state.diagnoses.length === 0 ? <Empty>No conditions yet.</Empty> : null}
        <div className="list">
          {state.diagnoses.map((d) => (
            <button type="button" className="row rowbtn" key={d.id} id={d.id} onClick={() => dx.open({ diagnosis: d })}>
              <span className="grow">
                <span className="row-title">{d.name}</span>
                {d.diagnosedOn === null ? null : <span className="row-meta">Since {fmtPlain(d.diagnosedOn)}</span>}
              </span>
              <StatusChip status={d.status} />
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Lab tests"
        actions={
          <button type="button" className="btn sm" onClick={() => test.open({ kind: "LAB" })}>
            <Icon name="plus" /> Add
          </button>
        }
      >
        {labs.length === 0 ? (
          <Empty>No lab tests yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Latest</th>
                  <th>Trend</th>
                  <th>Next</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {labs.map((s) => {
                  const t = s.test;
                  const due = s.due;
                  const expanded = openTest === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr id={t.id}>
                        <td>
                          <button type="button" className="linkish strong" onClick={() => setOpenTest(expanded ? null : t.id)} aria-expanded={expanded}>
                            {t.name}
                          </button>
                          {rangeText(t) === "" ? null : <div className="small muted">Normal {rangeText(t)} {t.unit}</div>}
                        </td>
                        <td className="num">
                          {s.latest === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              <b>{s.latest.value}</b> {t.unit} <FlagChip flag={s.flag} />
                              <div className="small muted">{fmtPlain(s.latest.date)}</div>
                            </>
                          )}
                        </td>
                        <td>
                          <Sparkline summary={s} />
                        </td>
                        <td>
                          {due === null ? (
                            <span className="muted">—</span>
                          ) : due.state === "NEVER_DONE" ? (
                            <span className="chip warn">Never done</span>
                          ) : due.state === "OVERDUE" ? (
                            <span className="chip warn">{-due.daysUntil} days overdue</span>
                          ) : due.state === "DUE_SOON" ? (
                            <span className="chip info">Due {relDays(view.today, due.nextDate)}</span>
                          ) : (
                            <span className="small">{fmtPlain(due.nextDate)}</span>
                          )}
                        </td>
                        <td className="nowrap">
                          <button type="button" className="btn sm" onClick={() => result.open(t)}>
                            <Icon name="plus" /> Result
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={5} className="expanded">
                            {s.results.length === 0 ? <Empty>No results yet.</Empty> : null}
                            <div className="list">
                              {s.results.map((r) => (
                                <div className="row" key={r.id} id={r.id}>
                                  <button type="button" className="linkish small" style={{ width: 130, textAlign: "left" }} onClick={() => edit.open({ test: t, result: r })}>
                                    {fmtResultDate(r)}
                                  </button>
                                  <span className="num grow">
                                    <b>{r.value}</b> {t.unit} <FlagChip flag={resultFlag(r.value, t.refLow, t.refHigh)} /> {r.source === "AI" ? <AiChip runId={r.aiRunId} /> : null}
                                    {r.note === "" ? null : <span className="muted small"> · {r.note}</span>}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn sm ghost"
                                    aria-label="Delete result"
                                    onClick={() => window.confirm("Delete this result?") && void run(() => command({ type: "delete", collection: "result", id: r.id }), "Result deleted.")}
                                  >
                                    <Icon name="trash" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button type="button" className="btn sm ghost" onClick={() => test.open({ test: t })}>
                              <Icon name="edit" /> Edit test
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Scans & reports"
        actions={
          <button type="button" className="btn sm" onClick={() => test.open({ kind: "IMAGING" })}>
            <Icon name="plus" /> Add
          </button>
        }
      >
        {reports.length === 0 ? <Empty>No scans or reports yet.</Empty> : null}
        <div className="reports">
          {reports.map((s) => {
            const t = s.test;
            const latest = s.latest;
            const expanded = openTest === t.id;
            return (
              <div className="report" key={t.id} id={t.id}>
                <div className="report-head">
                  <button type="button" className="linkish strong" onClick={() => test.open({ test: t })}>
                    {t.name}
                  </button>
                  <span className="chip">{KIND_LABEL[t.kind] ?? t.kind}</span>
                  {s.due === null ? null : s.due.state === "OVERDUE" ? (
                    <span className="chip warn">{-s.due.daysUntil} days overdue</span>
                  ) : s.due.state === "DUE_SOON" ? (
                    <span className="chip info">Due {relDays(view.today, s.due.nextDate)}</span>
                  ) : s.due.state === "NEVER_DONE" ? (
                    <span className="chip warn">Never done</span>
                  ) : null}
                </div>
                {latest === null ? (
                  <p className="muted small">No report saved yet.</p>
                ) : (
                  <button type="button" className="report-latest" id={latest.id} onClick={() => view_.open({ test: t, result: latest })}>
                    <span className="report-date">
                      {fmtResultDate(latest)}
                      {latest.facility ? ` · ${latest.facility}` : ""}
                    </span>
                    <span className="report-impression">{latest.impression || latest.value || latest.findings || latest.note || "Report"}</span>
                    {(latest.fileIds ?? []).length === 0 ? null : (
                      <span className="small muted">
                        <Icon name="doc" size={13} /> {(latest.fileIds ?? []).length === 1 ? "1 document" : `${(latest.fileIds ?? []).length} documents`}
                      </span>
                    )}
                  </button>
                )}
                <div className="report-actions">
                  <button type="button" className="btn sm" onClick={() => result.open(t)}>
                    <Icon name="plus" /> Add report
                  </button>
                  {s.results.length > 1 ? (
                    <button type="button" className="btn sm ghost" aria-expanded={expanded} onClick={() => setOpenTest(expanded ? null : t.id)}>
                      {expanded ? "Hide earlier" : `${s.results.length - 1} earlier`}
                    </button>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="list">
                    {s.results.slice(1).map((r) => (
                      <button type="button" className="row rowbtn" key={r.id} id={r.id} onClick={() => view_.open({ test: t, result: r })}>
                        <span className="small" style={{ width: 120, flex: "none" }}>
                          {fmtResultDate(r)}
                        </span>
                        <span className="grow clamp1">{r.impression || r.value || r.findings || "Report"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Modal open={dx.editor !== null} title={dx.editor?.diagnosis === undefined ? "New condition" : dx.editor.diagnosis.name} onClose={dx.close}>
        <DiagnosisForm {...(dx.editor?.diagnosis === undefined ? {} : { diagnosis: dx.editor.diagnosis })} onDone={dx.close} />
      </Modal>
      <Modal open={test.editor !== null} title={test.editor?.test === undefined ? "New test" : test.editor.test.name} onClose={test.close}>
        <TestForm {...(test.editor?.test === undefined ? {} : { test: test.editor.test })} {...(test.editor?.kind === undefined ? {} : { kind: test.editor.kind })} onDone={test.close} />
      </Modal>
      <Modal open={result.editor !== null} title={result.editor === null ? "" : isReportTest(result.editor) ? `New ${result.editor.name} report` : `${result.editor.name} result`} onClose={result.close}>
        {result.editor === null ? null : <ResultForm test={result.editor} onDone={result.close} />}
      </Modal>
      <Modal open={edit.editor !== null} title={edit.editor?.test.name ?? ""} onClose={edit.close}>
        {edit.editor === null ? null : <ResultForm test={edit.editor.test} result={edit.editor.result} onDone={edit.close} />}
      </Modal>
      <Modal open={view_.editor !== null} title={view_.editor === null ? "" : `${view_.editor.test.name}, ${fmtResultDate(view_.editor.result)}`} onClose={view_.close}>
        {view_.editor === null ? null : (
          <ReportView
            test={view_.editor.test}
            result={view_.editor.result}
            onEdit={() => {
              const e = view_.editor!;
              view_.close();
              edit.open(e);
            }}
          />
        )}
      </Modal>
    </>
  );
}

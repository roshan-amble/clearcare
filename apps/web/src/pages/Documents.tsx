import { useRef, useState, type DragEvent } from "react";
import type { StoredFile } from "@clearcare/domain";
import { useAction, useData } from "../data";
import { fileLabel, fmtDateTime } from "../format";
import { Card, Empty, Icon } from "../ui";

const size = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** Only what needs attention: still reading, or could not be read. A file read fine says nothing. */
function ReadNote({ file }: { readonly file: StoredFile }) {
  const r = file.read;
  if (r === undefined) return <span className="doc-read">Reading…</span>;
  if (r.status === "READ") return null;
  if (r.status === "EMPTY") return <span className="doc-read bad">No text found, so the chat can't read it.</span>;
  return <span className="doc-read bad">{r.note || "It could not be read."}</span>;
}

export function Documents() {
  const { payload, upload, post, notify } = useData();
  const { busy, run } = useAction();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState("");
  const all = payload.state.files.slice().sort((a, b) => (b.read?.date ?? b.uploadedAt).localeCompare(a.read?.date ?? a.uploadedAt));
  const q = query.trim().toLowerCase();
  const files = q === "" ? all : all.filter((f) => `${f.name} ${fileLabel(f)} ${f.read?.summary ?? ""} ${f.read?.title ?? ""}`.toLowerCase().includes(q));

  const send = async (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    for (const file of Array.from(list)) {
      setUploading(file.name);
      try {
        await upload(file);
      } catch (e) {
        notify(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
    setUploading(null);
    if (picker.current !== null) picker.current.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  };

  return (
    <>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input ref={picker} type="file" multiple hidden onChange={(e) => void send(e.target.files)} />
        <button type="button" className="btn primary" disabled={uploading !== null} onClick={() => picker.current?.click()}>
          <Icon name="upload" /> {uploading === null ? "Upload" : `Uploading ${uploading}…`}
        </button>
        <span className="muted small">or drop files here</span>
      </div>

      <Card title="Documents">
        {all.length > 8 ? <input className="doc-search" placeholder="Find a document" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a document" /> : null}
        {all.length === 0 ? <Empty>Nothing uploaded yet.</Empty> : files.length === 0 ? <Empty>No document matches.</Empty> : null}
        <div className="list">
          {files.map((f) => (
            <div className="row" key={f.id}>
              <Icon name="doc" />
              <a className="grow doc-link" href={`/api/files/${f.id}`} target="_blank" rel="noopener">
                <span className="row-title">{fileLabel(f)}</span>
                <span className="row-meta">
                  {f.read?.method === "CCDA"
                    ? [f.read.summary.split(" · ").slice(1).join(" · ") || f.read.title, f.name].filter((x) => x !== "").join(" · ")
                    : [size(f.size), `Uploaded ${fmtDateTime(f.uploadedAt)}`, f.by ?? null].filter((x) => x !== null).join(" · ")}
                </span>
                <ReadNote file={f} />
              </a>
              <button
                type="button"
                className="btn sm ghost"
                aria-label={`Delete ${f.name}`}
                disabled={busy}
                onClick={() => window.confirm(`Delete ${f.name}?`) && void run(() => post("/api/files/delete", { id: f.id }), "Deleted.")}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

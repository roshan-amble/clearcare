import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Command, HealthState, Role, View } from "@clearcare/domain";

export interface AiInfo {
  readonly available: boolean;
  readonly provider: "api" | "cli" | null;
  readonly description: string | null;
  readonly model: string;
  readonly chatEffort: string;
  readonly note: string;
}

export interface Viewer {
  readonly name: string;
  readonly role: Role;
  readonly login: string | null;
  /** True on the computer that runs ClearCare; false when signed in through Tailscale. */
  readonly local: boolean;
}

export interface Payload {
  readonly state: HealthState;
  readonly view: View;
  readonly ai: AiInfo;
  /** Shown only on the computer that runs ClearCare. */
  readonly dataFile: string | null;
  readonly viewer: Viewer;
  readonly sharing: { readonly tailnetPort: number | null };
  readonly refusedLogins: readonly { readonly login: string; readonly at: string }[];
  readonly createdIds?: readonly string[];
  readonly threadId?: string;
  readonly runId?: string;
  readonly docId?: string;
}

async function request(path: string, body?: unknown): Promise<Payload> {
  const init: RequestInit = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const json = (await res.json().catch(() => ({ error: `The server answered ${res.status}.` }))) as Payload & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json;
}

interface Toast {
  readonly message: string;
  readonly kind: "info" | "error";
}

interface DataApi {
  readonly payload: Payload;
  readonly post: (path: string, body: unknown) => Promise<Payload>;
  /** Sends one file as the request body; the server stores it in data/documents. */
  readonly upload: (file: File) => Promise<Payload>;
  readonly command: (command: Command) => Promise<Payload>;
  readonly notify: (message: string, kind?: Toast["kind"]) => void;
  readonly reload: () => Promise<void>;
}

const Ctx = createContext<DataApi | null>(null);

export function DataProvider({ children }: { readonly children: ReactNode }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const reload = useCallback(async () => {
    try {
      setPayload(await request("/api/state"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    // The view depends on today's date, so refresh when the tab comes back.
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const post = useCallback(async (path: string, body: unknown) => {
    const next = await request(path, body);
    setPayload(next);
    return next;
  }, []);

  const upload = useCallback(async (file: File) => {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    const json = (await res.json().catch(() => ({ error: `The server answered ${res.status}.` }))) as Payload & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
    setPayload(json);
    return json;
  }, []);

  const api = useMemo<DataApi | null>(
    () =>
      payload === null
        ? null
        : {
            payload,
            post,
            upload,
            command: (command: Command) => post("/api/command", { command }),
            notify: (message, kind = "info") => setToast({ message, kind }),
            reload,
          },
    [payload, post, upload, reload],
  );

  if (api === null) {
    return (
      <div style={{ padding: 40, fontFamily: "var(--sans)" }}>
        {error === null ? (
          <p className="muted">Opening the record…</p>
        ) : (
          <div className="banner error">
            <div>
              <div className="b-title">The ClearCare server is not answering.</div>
              <p>{error}</p>
              <p className="small">Start it with npm run dev in the clearcare folder, then reload this page.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      {toast === null ? null : (
        <div className={`toast ${toast.kind === "error" ? "error" : ""}`} role="status">
          {toast.message}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useData(): DataApi {
  const api = useContext(Ctx);
  if (api === null) throw new Error("useData outside DataProvider");
  return api;
}

/** Runs an action, showing its error as a toast. Returns null when it failed. */
export function useAction() {
  const { notify } = useData();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<T>, done?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await action();
        if (done !== undefined) notify(done);
        return result;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  return { busy, run };
}

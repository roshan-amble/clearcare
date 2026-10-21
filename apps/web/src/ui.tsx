import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { RedFlagResult, StatusChange } from "@clearcare/domain";
import { useData } from "./data";
import { fmtDateTime, recordHref, recordLabel, statusLabel } from "./format";

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  pill: (
    <>
      <path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7z" />
      <path d="m7 10 7 7" />
    </>
  ),
  flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" />,
  heart: <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" />,
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  alert: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  note: <path d="M4 4h16v12l-4 4H4zM16 20v-4h4M8 9h8M8 13h5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  send: <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />,
  theme: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18A9 9 0 0 0 12 3z" fill="currentColor" />
    </>
  ),
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  scale: <path d="M5 21h14M12 3v18M7 7l-4 8a4 4 0 0 0 8 0zM17 7l-4 8a4 4 0 0 0 8 0zM5 7h14" />,
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  id: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="11" r="2.5" />
      <path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  chevl: <path d="m15 18-6-6 6-6" />,
  chevr: <path d="m9 18 6-6-6-6" />,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { readonly name: string; readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Card(props: { readonly title?: ReactNode; readonly sub?: ReactNode; readonly actions?: ReactNode; readonly children: ReactNode; readonly id?: string; readonly className?: string }) {
  return (
    <section className={`card ${props.className ?? ""}`} id={props.id}>
      {props.title === undefined ? null : (
        <header className="card-h">
          <h2>{props.title}</h2>
          {props.sub === undefined ? null : <span className="sub">{props.sub}</span>}
          {props.actions === undefined ? null : <div className="actions">{props.actions}</div>}
        </header>
      )}
      <div className="card-b">{props.children}</div>
    </section>
  );
}

export function SectionHead(props: { readonly title: ReactNode; readonly sub?: ReactNode; readonly actions?: ReactNode }) {
  return (
    <div className="section-h">
      <h2>{props.title}</h2>
      {props.sub === undefined ? null : <span className="sub">{props.sub}</span>}
      {props.actions === undefined ? null : <div className="actions">{props.actions}</div>}
    </div>
  );
}

/** A link to a record, shown by its name. The ID stays out of sight, in the tooltip. */
export function RecordLink({ id }: { readonly id: string; readonly showName?: boolean }) {
  const { payload } = useData();
  const name = recordLabel(payload.state, id);
  if (/^F\d+$/.test(id)) return <span className="muted">{name}</span>;
  if (name === id) return <span className="muted">a removed record</span>;
  return (
    <Link to={recordHref(id)} className="reclink" title={id}>
      {name}
    </Link>
  );
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "brand",
  SCHEDULED: "info",
  TO_BOOK: "warn",
  COMPLETED: "ok",
  CANCELLED: "",
  PAUSED: "warn",
  STOPPED: "",
  MONITORING: "info",
  MANAGED: "ok",
  RESOLVED: "",
  OPEN: "info",
  ASKED: "ok",
  DROPPED: "",
};

export function StatusChip({ status }: { readonly status: string }) {
  return <span className={`chip ${STATUS_TONE[status] ?? ""}`}>{statusLabel(status)}</span>;
}

/** A small mark for records that came from a Claude suggestion. */
export function AiChip({ runId }: { readonly runId: string | null }) {
  return (
    <span className="ai-mark" title={runId === null ? "Added from an AI suggestion" : `Added from an AI suggestion (${runId})`} aria-label="Added from an AI suggestion">
      <Icon name="spark" size={12} />
    </span>
  );
}

/** Who added something, when known. */
export function By({ name }: { readonly name: string | undefined }) {
  if (name === undefined || name === "") return null;
  return <span className="muted small">{name}</span>;
}

export function History({ history }: { readonly history: readonly StatusChange[] }) {
  if (history.length === 0) return null;
  return (
    <ul className="history">
      {history
        .slice()
        .reverse()
        .map((h, i) => (
          <li key={i}>
            <span className="when num">{fmtDateTime(h.at).replace(" · 12:00 AM", "")}</span>
            {h.from === null ? `${statusLabel(h.to)}` : h.from === h.to ? "" : `${statusLabel(h.from)} → ${statusLabel(h.to)}`}
            {h.note === "" ? "" : `${h.from === h.to && h.from !== null ? "" : " · "}${h.note}`}
          </li>
        ))}
    </ul>
  );
}

/** The advice without the sentence the banner's title already says. */
const withoutTitle = (advice: string): string => {
  const rest = advice.replace(/^(Call 911 now|Call the doctor today)[.,]\s*/, "");
  return rest === "" ? advice : rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** The red-flag safety net: fixed rules, shown before and beside any AI answer. */
export function FlagBanner({ flags }: { readonly flags: RedFlagResult; readonly compact?: boolean }) {
  if (flags.level === null) return null;
  const emergency = flags.level === "EMERGENCY";
  const hit = flags.hits.find((h) => h.level === flags.level)!;
  return (
    <div className={`banner ${emergency ? "emergency" : "today"}`} role={emergency ? "alert" : "status"}>
      <Icon name={emergency ? "alert" : "phone"} size={18} />
      <div>
        <div className="b-title">{emergency ? "Call 911 now" : "Call the doctor today"}</div>
        <p>{withoutTitle(hit.advice)}</p>
      </div>
    </div>
  );
}

/** Scrolls to and highlights the element a #ID link points at. */
export function useHashHighlight(deps: readonly unknown[] = []) {
  const location = useLocation();
  const last = useRef<string>("");
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id === "" || id === last.current) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (el === null) return;
      last.current = id;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash, ...deps]);
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

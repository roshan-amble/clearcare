import type { HealthState, Role } from "@clearcare/domain";

/**
 * Who is using ClearCare. Two doors: "local" is this computer (the person who owns it), "tailnet" is the port only
 * Tailscale Serve forwards to. On the tailnet door every request must carry the login that Tailscale verified and
 * stamped on it (Tailscale strips any copy a client sends), and the login must be on the people list.
 */
export type Channel = "local" | "tailnet";

export interface Viewer {
  readonly name: string;
  readonly role: Role;
  /** The Tailscale login, or null on this computer. */
  readonly login: string | null;
  readonly local: boolean;
}

export type Resolution = { readonly ok: true; readonly viewer: Viewer } | { readonly ok: false; readonly login: string | null };

/** Tailscale encodes non-ASCII values as RFC 2047 "Q" words, such as =?utf-8?q?Jos=C3=A9?=. */
export function decodeHeader(value: string): string {
  const match = /^=\?utf-8\?q\?(.*)\?=$/i.exec(value.trim());
  if (match === null) return value.trim();
  try {
    return decodeURIComponent(match[1]!.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, "%$1"));
  } catch {
    return value.trim();
  }
}

export function resolveViewer(channel: Channel, headers: Readonly<Record<string, string | string[] | undefined>>, state: HealthState): Resolution {
  if (channel === "local") {
    const owner = state.people.find((p) => p.role === "CAREGIVER");
    return { ok: true, viewer: { name: owner?.name ?? "You", role: "CAREGIVER", login: null, local: true } };
  }
  const raw = headers["tailscale-user-login"];
  const login = typeof raw === "string" ? decodeHeader(raw).toLowerCase() : "";
  if (login === "") return { ok: false, login: null };
  const person = state.people.find((p) => p.login === login);
  if (person === undefined) return { ok: false, login };
  return { ok: true, viewer: { name: person.name, role: person.role, login, local: false } };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Host header a door accepts. A web page on another site that rebinds its own name to 127.0.0.1 still sends its
 * own name, so it is refused. The tailnet door also accepts this machine's *.ts.net name.
 */
export function hostAllowed(channel: Channel, host: string | undefined, extra: ReadonlySet<string>): boolean {
  if (host === undefined) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  if (LOCAL_HOSTS.has(name) || extra.has(name)) return true;
  return channel === "tailnet" && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name);
}

import { describe, expect, it } from "vitest";
import { emptyState, type HealthState } from "@clearcare/domain";
import { decodeHeader, hostAllowed, resolveViewer } from "./viewer.js";

const state: HealthState = {
  ...emptyState("2026-10-18T09:00"),
  people: [
    { login: "sam@example.com", name: "Sam", role: "CAREGIVER" },
    { login: "mom@example.com", name: "Mom", role: "PATIENT" },
  ],
};

describe("viewer", () => {
  it("lets this computer in as the first caregiver", () => {
    expect(resolveViewer("local", {}, state)).toEqual({ ok: true, viewer: { name: "Sam", role: "CAREGIVER", login: null, local: true } });
  });
  it("ignores Tailscale headers on the local door", () => {
    expect(resolveViewer("local", { "tailscale-user-login": "mom@example.com" }, state)).toMatchObject({ ok: true, viewer: { local: true } });
  });
  it("lets a listed Tailscale login in, in any letter case", () => {
    expect(resolveViewer("tailnet", { "tailscale-user-login": "Mom@Example.com" }, state)).toEqual({
      ok: true,
      viewer: { name: "Mom", role: "PATIENT", login: "mom@example.com", local: false },
    });
  });
  it("refuses the tailnet door without a login, or with one not on the list", () => {
    expect(resolveViewer("tailnet", {}, state)).toEqual({ ok: false, login: null });
    expect(resolveViewer("tailnet", { "tailscale-user-login": "stranger@example.com" }, state)).toEqual({ ok: false, login: "stranger@example.com" });
  });
  it("decodes non-ASCII header values", () => {
    expect(decodeHeader("=?utf-8?q?Jos=C3=A9_P?=")).toBe("José P");
    expect(decodeHeader("plain@example.com")).toBe("plain@example.com");
  });
  it("accepts a *.ts.net host only on the tailnet door", () => {
    const none = new Set<string>();
    expect(hostAllowed("tailnet", "my-mac.tail1234.ts.net", none)).toBe(true);
    expect(hostAllowed("local", "my-mac.tail1234.ts.net", none)).toBe(false);
    expect(hostAllowed("tailnet", "evil.example:8092", none)).toBe(false);
    expect(hostAllowed("local", "127.0.0.1:8090", none)).toBe(true);
  });
});

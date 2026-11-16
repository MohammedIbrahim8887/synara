import { describe, expect, it } from "vitest";
import { isLocalConnectionEndpoint, parseLocalDeviceInvitation } from "./localConnections";

const now = Date.now();
const invitation = {
  version: 1,
  kind: "sona-local",
  endpoint: "https://192.168.1.10:49000",
  certificateFingerprint: "a".repeat(64),
  credential: "23456789ABCD",
  expiresAt: new Date(now + 300_000).toISOString(),
};
describe("local pairing QR boundary", () => {
  it("accepts a current invitation from a private network", () => {
    expect(parseLocalDeviceInvitation(JSON.stringify(invitation), now)).toEqual(invitation);
  });
  it.each([
    "http://192.168.1.10",
    "https://example.com",
    "https://8.8.8.8",
    "https://127.0.0.1",
    "https://192.168.1.10/path",
    "https://user:secret@192.168.1.10",
    "https://192.168.1.10#token=x",
    "https://192.168.1.10?x=1",
  ])("refuses an invalid endpoint %s", (endpoint) => {
    expect(isLocalConnectionEndpoint(endpoint)).toBe(false);
    expect(() =>
      parseLocalDeviceInvitation(JSON.stringify({ ...invitation, endpoint }), now),
    ).toThrow();
  });
  it.each([
    { version: 2 },
    { kind: "other" },
    { certificateFingerprint: "bad" },
    { credential: "" },
    { credential: "too-short" },
    { credential: "a".repeat(8192) },
    { expiresAt: "invalid" },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 24 * 3600_000).toISOString() },
  ])("refuses malformed or expired invitations %j", (overrides) => {
    expect(() =>
      parseLocalDeviceInvitation(JSON.stringify({ ...invitation, ...overrides }), now),
    ).toThrow();
  });
  it("bounds QR input and rejects nonobjects", () => {
    for (const raw of ["x".repeat(8193), "null", "[]", "malformed"])
      expect(() => parseLocalDeviceInvitation(raw, now)).toThrow();
  });
});

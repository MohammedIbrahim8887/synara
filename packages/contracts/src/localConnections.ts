/** Local device pairing does not depend on the hosted account control plane. */
export interface LocalConnectionStatus {
  enabled: boolean;
  endpoints: string[];
  certificateFingerprint: string | null;
}
export interface LocalDeviceInvitation {
  version: 1;
  kind: "sona-local";
  endpoint: string;
  certificateFingerprint: string;
  credential: string;
  expiresAt: string;
}

/** Pairing accepts numeric LAN addresses only; no public DNS or URL credentials. */
export function isLocalConnectionEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const parts = url.hostname.split(".").map(Number);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (parts[0] === 10 ||
        (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 169 && parts[1] === 254))
    );
  } catch {
    return false;
  }
}

export function parseLocalDeviceInvitation(raw: string, now = Date.now()): LocalDeviceInvitation {
  if (raw.length > 8192) throw new Error("Invalid pairing code.");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid pairing code.");
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    data.kind !== "sona-local" ||
    !isLocalConnectionEndpoint(data.endpoint) ||
    typeof data.certificateFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.certificateFingerprint) ||
    typeof data.credential !== "string" ||
    !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(data.credential) ||
    typeof data.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(data.expiresAt)) ||
    Date.parse(data.expiresAt) <= now ||
    Date.parse(data.expiresAt) > now + 10 * 60_000
  ) {
    throw new Error("Invalid or expired pairing code.");
  }
  return data as unknown as LocalDeviceInvitation;
}

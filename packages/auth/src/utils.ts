import { randomBytes, createHmac, createHash, scryptSync, timingSafeEqual } from "node:crypto";

export function clone<T>(value: T): T {
  return value === undefined ? (undefined as T) : structuredClone(value);
}

export function now(): number {
  return Date.now();
}

export function randomId(prefix = "bf"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function bufferToBase64Url(value: string | Uint8Array | ArrayBuffer): string {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8").toString("base64url");
  }

  return Buffer.from(value as Uint8Array).toString("base64url");
}

export function base64UrlToBuffer(value: unknown): Buffer {
  return Buffer.from(String(value || ""), "base64url");
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function signToken(payload: unknown, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken(token: unknown, secret: string): any {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest();
  const actualSignature = Buffer.from(signature, "base64url");
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function parseDuration(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }

  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(String(value || ""));
  if (!match) {
    throw new Error(`Unsupported duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase() as "ms" | "s" | "m" | "h" | "d";
  const multipliers: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[unit]!;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

export function normalizeEmail(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function verifyPassword(password: string, encodedHash: unknown): boolean {
  const [algorithm, salt, digest] = String(encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !digest) {
    return false;
  }

  const expected = Buffer.from(digest, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isSafeRedirectTarget(value: unknown): boolean {
  const redirectTarget = String(value || "");
  if (!redirectTarget.startsWith("/")) {
    return false;
  }

  if (redirectTarget.startsWith("//")) {
    return false;
  }

  if (/[\r\n]/.test(redirectTarget)) {
    return false;
  }

  return true;
}

export function escapeXml(value: unknown): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function getPathValue(source: any, path: unknown): any {
  if (path === null || path === undefined) {
    return undefined;
  }

  if (typeof path !== "string") {
    return path;
  }

  if (!path.includes(".")) {
    return source?.[path];
  }

  return path.split(".").reduce((accumulator: any, key: string) => {
    if (accumulator === null || accumulator === undefined) {
      return undefined;
    }

    return accumulator[key];
  }, source);
}

export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

export function maskValue(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length <= 4) {
      return "*".repeat(value.length);
    }

    return `${value.slice(0, 2)}${"*".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
  }

  if (typeof value === "number") {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.map(maskValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, innerValue]) => [key, maskValue(innerValue)]));
  }

  return "***";
}

export function readBearerToken(headers: Record<string, string | string[] | undefined> = {}): string | null {
  const authorization = headers.authorization || headers.Authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = String(authorization).split(" ");
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return token || null;
}

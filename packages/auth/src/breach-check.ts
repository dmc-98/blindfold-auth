/**
 * Breach-password check via the HIBP Pwned Passwords range API using
 * k-anonymity: only the first 5 hex characters of the SHA-1 ever leave the
 * process; the full hash is compared locally against the returned range.
 * (PRD: credential-stuffing defenses. Privacy posture matches the brand —
 * no password, no full hash, no identifying data is transmitted.)
 *
 * Fail-open by default (checked:false on network errors) so an HIBP outage
 * can never lock users out of registration; callers that prefer fail-closed
 * can branch on `checked`.
 */
import { createHash } from "node:crypto";

export interface BreachCheckResult {
  /** False when the check could not be performed (network/HTTP failure). */
  checked: boolean;
  breached: boolean;
  /** Times this password appears in known breaches (0 when clean/unchecked). */
  count: number;
}

export interface BreachCheckOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the API base (e.g. a caching proxy). */
  apiBase?: string;
  timeoutMs?: number;
}

export async function checkPasswordBreached(
  password: string,
  { fetchImpl = fetch, apiBase = "https://api.pwnedpasswords.com", timeoutMs = 5000 }: BreachCheckOptions = {}
): Promise<BreachCheckResult> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiBase}/range/${prefix}`, {
      signal: controller.signal,
      headers: { "Add-Padding": "true" } // HIBP response padding — hides range size from observers
    });
    if (!response.ok) return { checked: false, breached: false, count: 0 };
    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const [candidate, countText] = line.split(":");
      if (candidate === suffix) {
        return { checked: true, breached: true, count: Number(countText) || 1 };
      }
    }
    return { checked: true, breached: false, count: 0 };
  } catch {
    return { checked: false, breached: false, count: 0 };
  } finally {
    clearTimeout(timer);
  }
}

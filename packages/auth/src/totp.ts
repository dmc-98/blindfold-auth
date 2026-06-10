import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer | Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let current = 0;
  const output: number[] = [];

  for (const character of String(value || "").replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      continue;
    }

    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function hotp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
}

export function generateTotpSecret(length = 20): string {
  return base32Encode(randomBytes(length));
}

export function getTotpCode(secret: string, time = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(time / 1000 / stepSeconds);
  return hotp(secret, counter);
}

export function verifyTotpCode(
  secret: string,
  code: unknown,
  { window = 1, time = Date.now(), stepSeconds = 30 }: { window?: number; time?: number; stepSeconds?: number } = {}
): boolean {
  const baseCounter = Math.floor(time / 1000 / stepSeconds);
  const normalizedCode = String(code || "").replace(/\s+/g, "");

  for (let offset = -window; offset <= window; offset += 1) {
    if (hotp(secret, baseCounter + offset) === normalizedCode) {
      return true;
    }
  }

  return false;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(4).toString("hex"));
}

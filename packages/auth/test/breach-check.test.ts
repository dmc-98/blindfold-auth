import { test } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { checkPasswordBreached } from "../src/breach-check.js";

// Build a fake HIBP range response containing the suffix for "password123".
function fakeHibp(password: string, count: number) {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const suffix = sha1.slice(5);
  const body = `00000AAAA:1\r\n${suffix}:${count}\r\nFFFFFBBBB:2`;
  let requestedUrl = "";
  const fetchImpl = async (url: string) => {
    requestedUrl = url;
    return { ok: true, status: 200, text: async () => body } as Response;
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requestedUrl: () => requestedUrl, prefix: sha1.slice(0, 5) };
}

test("breached password is detected with its count; only the 5-char prefix leaves the process", async () => {
  const { fetchImpl, requestedUrl, prefix } = fakeHibp("password123", 99999);
  const result = await checkPasswordBreached("password123", { fetchImpl });
  assert.equal(result.breached, true);
  assert.equal(result.count, 99999);
  assert.ok(requestedUrl().endsWith(`/range/${prefix}`), `url was ${requestedUrl()}`);
  assert.ok(!requestedUrl().includes("password123"), "raw password must never appear in the URL");
  assert.ok(!requestedUrl().toUpperCase().includes(createHash("sha1").update("password123").digest("hex").toUpperCase().slice(5)), "full hash suffix must never leave the process");
});

test("clean password returns breached:false", async () => {
  const { fetchImpl } = fakeHibp("some-other-password", 5);
  const result = await checkPasswordBreached("correct-horse-battery-staple-9!", { fetchImpl });
  assert.equal(result.breached, false);
  assert.equal(result.count, 0);
});

test("fail-open by default with a checked:false marker when HIBP is unreachable", async () => {
  const fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  const result = await checkPasswordBreached("anything", { fetchImpl });
  assert.equal(result.checked, false);
  assert.equal(result.breached, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { attachVirtualAuthenticator, createHarness, launchBrowser, readJsonFromPre, waitForText } from "./support/harness.js";

test("Runtime browser flow covers passkeys, federation, refresh, revoke, magic link, TOTP, and authz results", async (t: any) => {
  const harness = await createHarness(t);
  if (!harness) {
    return;
  }

  const browser = await launchBrowser(t);
  if (!browser) {
    await harness.close();
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const authenticator = await attachVirtualAuthenticator(page);

  try {
    await page.goto(harness.runtime.url);

    await page.click("#loginButton");
    await waitForText(page, "#authOutput", '"authStrength": "password"');
    const passwordLogin = await readJsonFromPre(page, "#authOutput");
    const initialSessionId = passwordLogin.payload.session.id;

    await page.click("#maskedRouteButton");
    await waitForText(page, "#protectedOutput", '"effect": "mask"');
    const maskedDecision = await readJsonFromPre(page, "#protectedOutput");
    assert.equal(maskedDecision.status, 200);
    assert.equal(maskedDecision.payload.effect, "mask");
    assert.equal(maskedDecision.payload.obligations.maskedFields.includes("internalNotes"), true);

    await page.click("#denyRouteButton");
    await waitForText(page, "#protectedOutput", '"default deny"');
    const deniedDecision = await readJsonFromPre(page, "#protectedOutput");
    assert.equal(deniedDecision.status, 403);
    assert.equal(deniedDecision.payload.error, "default deny");

    await page.click("#refreshSessionButton");
    await page.waitForFunction(
      ({ selector, previousSessionId }: any) => {
        const node = document.querySelector(selector);
        if (!node) {
          return false;
        }

        try {
          const parsed = JSON.parse(node.textContent || "{}");
          return (
            parsed?.status === 200 &&
            parsed?.payload?.session?.id &&
            parsed.payload.session.id !== previousSessionId
          );
        } catch {
          return false;
        }
      },
      { selector: "#authOutput", previousSessionId: initialSessionId }
    );
    const refreshed = await readJsonFromPre(page, "#authOutput");
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.payload.session.id, initialSessionId);

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');
    await page.click("#maskedRouteButton");
    await waitForText(page, "#protectedOutput", '"missing bearer token"');
    const revokedAttempt = await readJsonFromPre(page, "#protectedOutput");
    assert.equal(revokedAttempt.status, 401);

    await page.click("#requestMagicLinkButton");
    await waitForText(page, "#magicLinkOutput", '"token"');
    await page.click("#consumeMagicLinkButton");
    await waitForText(page, "#authOutput", '"authStrength": "magic_link"');
    const magicLinkLogin = await readJsonFromPre(page, "#authOutput");
    assert.equal(magicLinkLogin.status, 200);
    assert.equal(magicLinkLogin.payload.session.authStrength, "magic_link");

    await page.click("#passkeyEnrollButton");
    await waitForText(page, "#authOutput", '"ok": true');
    const passkeyEnrollment = await readJsonFromPre(page, "#authOutput");
    assert.equal(passkeyEnrollment.status, 200);
    assert.equal(passkeyEnrollment.payload.credential.status, "active");

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');
    await page.click("#passkeyLoginButton");
    await waitForText(page, "#authOutput", '"authStrength": "passkey"');
    const passkeyLogin = await readJsonFromPre(page, "#authOutput");
    assert.equal(passkeyLogin.status, 200);
    assert.equal(passkeyLogin.payload.session.authStrength, "passkey");

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');
    await page.click("#useOidcProfileButton");
    await page.click("#oidcButton");
    await page.waitForFunction((selector: any) => {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      try {
        const parsed = JSON.parse(node.textContent || "{}");
        return parsed?.status === 200 && parsed?.payload?.session?.authStrength === "oidc";
      } catch {
        return false;
      }
    }, "#authOutput");
    const oidcLogin = await readJsonFromPre(page, "#authOutput");
    assert.equal(oidcLogin.status, 200);
    assert.equal(oidcLogin.payload.session.authStrength, "oidc");
    assert.equal(oidcLogin.payload.session.applicationId, harness.application.id);

    await page.click("#maskedRouteButton");
    await waitForText(page, "#protectedOutput", '"principalEmail": "jordan@okta.example.com"');
    const oidcProtected = await readJsonFromPre(page, "#protectedOutput");
    assert.equal(oidcProtected.status, 200);
    assert.equal(oidcProtected.payload.principalEmail, "jordan@okta.example.com");

    await page.click("#logoutButton");
    await waitForText(page, "#authOutput", '"ok": true');
    await page.click("#useSamlProfileButton");
    await page.click("#samlButton");
    await page.waitForFunction((selector: any) => {
      const node = document.querySelector(selector);
      if (!node) {
        return false;
      }

      try {
        const parsed = JSON.parse(node.textContent || "{}");
        return parsed?.status === 200 && parsed?.payload?.session?.authStrength === "saml";
      } catch {
        return false;
      }
    }, "#authOutput");
    const samlLogin = await readJsonFromPre(page, "#authOutput");
    assert.equal(samlLogin.status, 200);
    assert.equal(samlLogin.payload.session.authStrength, "saml");
    assert.equal(samlLogin.payload.session.applicationId, harness.application.id);

    await page.click("#useMfaProfileButton");
    await page.click("#loadTotpButton");
    await page.click("#loginButton");
    await waitForText(page, "#authOutput", '"authStrength": "mfa"');
    const mfaLogin = await readJsonFromPre(page, "#authOutput");
    assert.equal(mfaLogin.status, 200);
    assert.equal(mfaLogin.payload.session.authStrength, "mfa");
  } finally {
    await authenticator.close();
    await context.close();
    await browser.close();
    await harness.close();
  }
});

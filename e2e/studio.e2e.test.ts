import assert from "node:assert/strict";
import test from "node:test";
import { createHarness, launchBrowser, readJsonFromPre, waitForText } from "./support/harness.js";

test("Studio browser flow bootstraps data, configures providers, and explains a masked policy decision", async (t: any) => {
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

  try {
    await page.goto(harness.studio.url);
    await waitForText(page, "#statusBox", "Snapshot refreshed.");

    await page.click("#bootstrapButton");
    await waitForText(page, "#metrics", "Blindfold Workspace");

    await page.fill('#applicationForm [name="slug"]', "studio-billing");
    await page.fill('#applicationForm [name="name"]', "Studio Billing");
    await page.fill('#applicationForm [name="description"]', "Studio-created app");
    await page.click('#applicationForm button[type="submit"]');
    await waitForText(page, "#applicationsList", "studio-billing");

    await page.fill('#principalForm [name="displayName"]', "Studio Finance User");
    await page.fill('#principalForm [name="email"]', "studio-finance@example.com");
    await page.fill('#principalForm [name="password"]', "studio-password-123");
    await page.fill('#principalForm [name="attributes"]', '{"department":"finance","region":"in"}');
    await page.click('#principalForm button[type="submit"]');
    await waitForText(page, "#principalsList", "studio-finance@example.com");

    await page.fill('#identityProviderForm [name="key"]', "studio-okta");
    await page.fill('#identityProviderForm [name="name"]', "Studio Okta");
    await page.selectOption('#identityProviderForm select[name="type"]', "oidc");
    await page.fill('#identityProviderForm [name="issuer"]', "https://studio.okta.example.com/oauth2/default");
    await page.fill('#identityProviderForm [name="authorizationUrl"]', "https://studio.okta.example.com/oauth2/v1/authorize");
    await page.fill('#identityProviderForm [name="clientId"]', "studio-okta-client");
    await page.click('#identityProviderForm button[type="submit"]');
    await waitForText(page, "#identityProvidersList", "Studio Okta");

    const initialSnapshot = await page.evaluate(async () => {
      const response = await fetch("/api/workspace");
      return response.json();
    });

    const application = initialSnapshot.snapshot.applications.find((item: any) => item.slug === "studio-billing");
    const principal = initialSnapshot.snapshot.principals.find((item: any) => item.email === "studio-finance@example.com");
    const provider = initialSnapshot.snapshot.identity_providers.find((item: any) => item.key === "studio-okta");

    assert.ok(application);
    assert.ok(principal);
    assert.ok(provider);

    await page.fill('#roleForm [name="applicationId"]', application.id);
    await page.fill('#roleForm [name="name"]', "studio_finance_admin");
    await page.fill('#roleForm [name="description"]', "Studio-created finance role");
    await page.click('#roleForm button[type="submit"]');

    const roleSnapshot = await page.evaluate(async () => {
      const response = await fetch("/api/workspace");
      return response.json();
    });
    const role = roleSnapshot.snapshot.roles.find((item: any) => item.name === "studio_finance_admin");
    assert.ok(role);

    await page.fill('#applicationProviderForm [name="applicationId"]', application.id);
    await page.fill('#applicationProviderForm [name="providerId"]', provider.id);
    await page.fill('#applicationProviderForm [name="domains"]', "studio.example.com");
    await page.fill('#applicationProviderForm [name="defaultRoleIds"]', role.id);
    await page.fill('#applicationProviderForm [name="claimMappings"]', '{"email":"email","displayName":"name"}');
    await page.fill('#applicationProviderForm [name="clientId"]', "studio-okta-client");
    await page.click('#applicationProviderForm button[type="submit"]');
    await waitForText(page, "#applicationProvidersList", "studio.example.com");

    await page.fill('#permissionForm [name="applicationId"]', application.id);
    await page.fill('#permissionForm [name="roleId"]', role.id);
    await page.fill('#permissionForm [name="resource"]', "invoice");
    await page.fill('#permissionForm [name="action"]', "read");
    await page.fill('#permissionForm [name="field"]', "*");
    await page.click('#permissionForm button[type="submit"]');

    await page.fill('#membershipForm [name="applicationId"]', application.id);
    await page.fill('#membershipForm [name="principalId"]', principal.id);
    await page.fill('#membershipForm [name="roleId"]', role.id);
    await page.click('#membershipForm button[type="submit"]');

    await page.fill('#policyForm [name="applicationId"]', application.id);
    await page.fill('#policyForm [name="resource"]', "invoice");
    await page.fill('#policyForm [name="action"]', "read");
    await page.fill('#policyForm [name="field"]', "internalNotes");
    await page.selectOption('#policyForm select[name="effect"]', "mask");
    await page.fill('#policyForm [name="conditionJson"]', '{"eq":["subject.department","finance"]}');
    await page.click('#policyForm button[type="submit"]');
    await waitForText(page, "#policiesList", "internalNotes");

    await page.fill('#debugForm [name="applicationId"]', application.id);
    await page.fill('#debugForm [name="principalId"]', principal.id);
    await page.fill('#debugForm [name="resource"]', "invoice");
    await page.fill('#debugForm [name="action"]', "read");
    await page.fill('#debugForm [name="field"]', "internalNotes");
    await page.fill('#debugForm [name="resourceAttributes"]', '{}');
    await page.click('#debugForm button[type="submit"]');
    await waitForText(page, "#debugOutput", '"effect": "mask"');

    const decision = await readJsonFromPre(page, "#debugOutput");
    assert.equal(decision.allowed, true);
    assert.equal(decision.effect, "mask");
    assert.equal(decision.obligations.maskedFields.includes("internalNotes"), true);
    await waitForText(page, "#auditList", "policy.created");
  } finally {
    await context.close();
    await browser.close();
    await harness.close();
  }
});

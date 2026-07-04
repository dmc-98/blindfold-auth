/**
 * setup.ts — one-time provider + binding registration for the Okta OIDC example.
 *
 * Run ONCE before starting the server:
 *   cp .env.example .env  # fill in your credentials
 *   npm run setup
 *
 * Safe to re-run — providers and bindings are idempotent by key.
 * See docs/sso/okta.md Step 3 for a full walkthrough.
 */

import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const requiredEnv = [
  "BLINDFOLD_WORKSPACE_ID",
  "BLINDFOLD_SECRET",
  "OKTA_CLIENT_ID",
  "OKTA_CLIENT_SECRET",
  "OKTA_DOMAIN",
] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    console.error("Copy .env.example → .env and fill in your credentials.");
    process.exit(1);
  }
}

const auth = createAuth({
  workspaceId: process.env.BLINDFOLD_WORKSPACE_ID!,
  secret: process.env.BLINDFOLD_SECRET!,
  storage: createFileStorage({ filePath: ".blindfold/workspace.json" }),
});

const sso = createSso({ auth });

const oktaDomain = process.env.OKTA_DOMAIN!.replace(/\/$/, "");

console.log("Registering Okta OIDC provider…");
const provider = await sso.providers.add({
  type: "oidc",
  key: "okta",
  name: "Okta",
  mode: "live",
  discoveryUrl: `${oktaDomain}/.well-known/openid-configuration`,
  clientId: process.env.OKTA_CLIENT_ID!,
  clientSecret: process.env.OKTA_CLIENT_SECRET!,
});
console.log(`  ✓ Provider registered: ${provider.id}`);

const appId = process.env.APP_ID ?? "app_default";
const oktaEmailDomain = new URL(oktaDomain).hostname; // e.g. dev-xxxxx.okta.com

console.log(`Binding provider to application "${appId}"…`);
await sso.bindings.add({
  applicationId: appId,
  providerId: provider.id,
  // Domain routing: users whose email domain matches will be auto-routed to Okta.
  // Update this to your company's real email domain, e.g. ["acme.com"].
  domains: [oktaEmailDomain],
});
console.log(`  ✓ Binding created (domain routing: ${oktaEmailDomain})`);

console.log("\nSetup complete. Run: npm start");

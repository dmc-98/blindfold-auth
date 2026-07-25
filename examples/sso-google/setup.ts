/**
 * setup.ts — one-time provider + binding registration for the Google Workspace OIDC example.
 *
 * Run ONCE before starting the server:
 *   cp .env.example .env  # fill in your credentials
 *   npm run setup
 *
 * Safe to re-run — providers and bindings are idempotent by key.
 * See docs/sso/google.md Step 3 for a full walkthrough.
 */

import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const requiredEnv = [
  "BLINDFOLD_WORKSPACE_ID",
  "BLINDFOLD_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_DOMAIN",
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

// Google publishes one OIDC discovery document for all tenants;
// organisation restriction happens via binding domains (and the consent
// screen's Internal user type on Google's side).
const discoveryUrl =
  "https://accounts.google.com/.well-known/openid-configuration";

console.log("Registering Google Workspace OIDC provider…");
console.log(`  Discovery URL: ${discoveryUrl}`);

const provider = await sso.providers.add({
  type: "oidc",
  key: "google",
  name: "Google",
  mode: "live",
  discoveryUrl,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
});
console.log(`  ✓ Provider registered: ${provider.id}`);

const appId = process.env.APP_ID ?? "app_default";

// Domain routing: users whose email domain matches are auto-routed to Google.
// Set GOOGLE_WORKSPACE_DOMAIN to your company's Workspace primary domain
// (e.g. "acme.co"). Consumer @gmail.com accounts will not match the binding.
const emailDomain = process.env.GOOGLE_WORKSPACE_DOMAIN!;

console.log(`Binding provider to application "${appId}"…`);
await sso.bindings.add({
  applicationId: appId,
  providerId: provider.id,
  domains: [emailDomain],
});
console.log(`  ✓ Binding created (domain routing: ${emailDomain})`);
console.log(
  `\nSetup complete. Run: npm start\n` +
    `  SSO callback URL (register in Google Cloud Console): http://localhost:${process.env.PORT ?? 3000}/auth/sso/oidc/callback`
);

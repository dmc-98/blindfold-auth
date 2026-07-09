/**
 * setup.ts — one-time provider + binding registration for the Entra ID OIDC example.
 *
 * Run ONCE before starting the server:
 *   cp .env.example .env  # fill in your credentials
 *   npm run setup
 *
 * Safe to re-run — providers and bindings are idempotent by key.
 * See docs/sso/entra.md Step 3 for a full walkthrough.
 */

import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const requiredEnv = [
  "BLINDFOLD_WORKSPACE_ID",
  "BLINDFOLD_SECRET",
  "ENTRA_CLIENT_ID",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_TENANT_ID",
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

const tenantId = process.env.ENTRA_TENANT_ID!;
const discoveryUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

console.log("Registering Microsoft Entra ID OIDC provider…");
console.log(`  Discovery URL: ${discoveryUrl}`);

const provider = await sso.providers.add({
  type: "oidc",
  key: "entra",
  name: "Microsoft",
  mode: "live",
  discoveryUrl,
  clientId: process.env.ENTRA_CLIENT_ID!,
  clientSecret: process.env.ENTRA_CLIENT_SECRET!,
});
console.log(`  ✓ Provider registered: ${provider.id}`);

const appId = process.env.APP_ID ?? "app_default";

// Domain routing: users whose email domain matches are auto-routed to Entra.
// If ENTRA_DOMAIN is set, use it; otherwise fall back to the tenant's default onmicrosoft domain.
// Update this to your company's real email domain (e.g. "contoso.com").
const emailDomain = process.env.ENTRA_DOMAIN ?? `${tenantId}.onmicrosoft.com`;

console.log(`Binding provider to application "${appId}"…`);
await sso.bindings.add({
  applicationId: appId,
  providerId: provider.id,
  domains: [emailDomain],
});
console.log(`  ✓ Binding created (domain routing: ${emailDomain})`);
console.log(
  `\nSetup complete. Run: npm start\n` +
  `  SSO callback URL (register in Azure): http://localhost:${process.env.PORT ?? 3000}/auth/sso/oidc/callback`
);

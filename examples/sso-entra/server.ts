/**
 * server.ts — Microsoft Entra ID OIDC SSO example for Blindfold Auth.
 *
 * Prerequisites:
 *   1. Copy .env.example → .env and fill in credentials
 *   2. Run `npm run setup` once to register the Entra provider + binding
 *   3. Run `npm start` (or `npm run dev` for ts-node hot-reload)
 *
 * See docs/sso/entra.md for the full step-by-step guide, including:
 *   - Registering an application in Entra ID (Azure AD)
 *   - Validating IdP metadata with `blindfold sso doctor`
 *   - Group-based role mapping and SAML 2.0 variant
 */

import cookieParser from "cookie-parser";
import express from "express";
import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const APP_ID = process.env.APP_ID ?? "app_default";

// ── Auth + SSO setup ────────────────────────────────────────────────────────

const auth = createAuth({
  workspaceId: process.env.BLINDFOLD_WORKSPACE_ID!,
  secret: process.env.BLINDFOLD_SECRET!,
  storage: createFileStorage({ filePath: ".blindfold/workspace.json" }),
});

const sso = createSso({ auth });

// ── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Landing page with sign-in form ──────────────────────────────────────────

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Blindfold + Entra ID OIDC demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; }
    input { width: 100%; padding: 10px; margin: 8px 0 16px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    button { background: #0078d4; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; cursor: pointer; width: 100%; }
    button:hover { background: #005a9e; }
    .note { font-size: 13px; color: #666; margin-top: 12px; }
  </style>
</head>
<body>
  <h2>Blindfold + Microsoft Entra ID</h2>
  <p>Enter your work email to sign in via Microsoft (optional — leave blank to skip domain routing).</p>
  <form method="POST" action="/auth/sso/start">
    <input name="email" type="email" placeholder="you@yourcompany.com" />
    <button type="submit">Sign in with Microsoft →</button>
  </form>
  <p class="note">
    This demo uses <a href="https://github.com/dmc-98/blindfold-auth">Blindfold Auth</a>
    for SSO. See <code>docs/sso/entra.md</code> for the full recipe.
  </p>
</body>
</html>`);
});

// ── Initiate SSO login ───────────────────────────────────────────────────────
// POST /auth/sso/start  { email?: string }
// → 302 redirect to Microsoft login (login.microsoftonline.com)

app.post("/auth/sso/start", async (req, res) => {
  try {
    const result = await sso.login.start({
      protocol: "oidc",
      applicationId: APP_ID,
      email: (req.body.email as string | undefined) || undefined,
      request: { headers: req.headers as Record<string, string> },
    });

    if ("multipleProviders" in result) {
      // Multiple providers matched — surface a provider-picker UI (simplified here)
      return res.status(409).send(`
        <p>Multiple providers found. Pick one:</p>
        ${result.multipleProviders
          .map(
            (p: { id: string; name: string }) =>
              `<form method="POST" action="/auth/sso/start">
                 <input type="hidden" name="providerId" value="${p.id}" />
                 <button type="submit">${p.name}</button>
               </form>`
          )
          .join("")}
      `);
    }

    res.redirect(result.redirectTo);
  } catch (err: unknown) {
    console.error("SSO start error:", err);
    res.status(500).send(`SSO initiation failed: ${(err as Error).message}`);
  }
});

// ── Handle the Entra ID callback ─────────────────────────────────────────────
// GET /auth/sso/oidc/callback?code=…&state=…
// → sets session cookie + redirects to /dashboard

app.get("/auth/sso/oidc/callback", async (req, res) => {
  try {
    const result = await sso.login.complete({
      protocol: "oidc",
      payload: req.query as Record<string, unknown>,
      request: { headers: req.headers as Record<string, string> },
    });

    // accessToken is a signed JWT — store it however your app normally handles sessions.
    res.cookie("session", result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.redirect("/dashboard");
  } catch (err: unknown) {
    console.error("SSO callback error:", err);
    // Common Entra errors include AADSTS codes — surface them for easier debugging
    const message = (err as Error).message;
    res
      .status(401)
      .send(`Authentication failed: ${message}. <a href="/">Try again</a>`);
  }
});

// ── Protected route ──────────────────────────────────────────────────────────

app.get("/dashboard", async (req, res) => {
  const token = req.cookies?.session as string | undefined;
  if (!token) {
    return res.redirect("/");
  }

  try {
    const session = await auth.handlers.session.verify()({
      headers: { authorization: `Bearer ${token}` },
    });
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Dashboard — Blindfold + Entra ID</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 24px; }
    pre { background: #f4f4f4; border-radius: 8px; padding: 16px; font-size: 13px; overflow-x: auto; }
    a { color: #0078d4; }
  </style>
</head>
<body>
  <h2>✓ Signed in via Microsoft Entra ID</h2>
  <p>Session details:</p>
  <pre>${JSON.stringify(session, null, 2)}</pre>
  <p><a href="/logout">Sign out</a></p>
</body>
</html>`);
  } catch {
    res.clearCookie("session");
    res.redirect("/");
  }
});

// ── Sign out ─────────────────────────────────────────────────────────────────

app.get("/logout", (_req, res) => {
  res.clearCookie("session");
  // Optionally also sign out from Entra:
  // res.redirect(`https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=http://localhost:${PORT}`);
  res.redirect("/");
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(
    `SSO callback URL (register in Azure): http://localhost:${PORT}/auth/sso/oidc/callback`
  );
});

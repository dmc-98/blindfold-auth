#!/usr/bin/env node
/**
 * Build the Blindfold Auth marketing landing page (premium, dev-infra grade).
 *
 * The framework code samples are generated from the SAME `generateSnippet()` the
 * SDK/CLI/MCP use, so the marketing site can never drift from real integration
 * code. Output: landing/index.html (single self-contained file).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateSnippet, SNIPPET_FRAMEWORKS } from "@blindfold/client";

// Output to the repo root's landing/ dir. npm scripts run from the repo root,
// so process.cwd() is stable regardless of the compiled script's own location.
const root = process.cwd();
const outFile = resolve(root, "landing/index.html");
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const snippets: Record<string, string> = Object.fromEntries(
  SNIPPET_FRAMEWORKS.map((fw: string) => [fw, generateSnippet({ framework: fw, project: "my-app", storage: "postgres" })])
);

/* ---------- content ---------- */
const ICONS: Record<string, string> = {
  key: '<path d="M14 7a4 4 0 1 0-3.9 5H13v2h2v2h2v-2.1A4 4 0 0 0 14 7Zm-4 3.5A1.5 1.5 0 1 1 11.5 9 1.5 1.5 0 0 1 10 10.5Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5Zm0 18c-3.4-1.1-6-4-6-9V6.3l6-2.2 6 2.2V11c0 5-2.6 7.9-6 9Z"/>',
  building: '<path d="M3 21V5l8-3v19H3Zm10 0V9l8 3v9h-8ZM6 8h2v2H6Zm0 4h2v2H6Z"/>',
  db: '<path d="M12 3c-4.4 0-8 1.6-8 3.5v11C4 19.4 7.6 21 12 21s8-1.6 8-3.5v-11C20 4.6 16.4 3 12 3Zm6 14.5c0 .7-2.6 2-6 2s-6-1.3-6-2V14c1.5.9 3.8 1.4 6 1.4s4.5-.5 6-1.4Zm0-4.5c0 .7-2.6 2-6 2s-6-1.3-6-2V9.4c1.5.9 3.8 1.4 6 1.4s4.5-.5 6-1.4Z"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6v2h-4.8l-3.2 9.6L9.1 9 7.8 14H3Z"/>',
  phone: '<path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v14h10V4Zm4 15h2v1h-2Z"/>',
  home: '<path d="m12 3 9 8h-3v9h-4v-6h-4v6H6v-9H3Z"/>',
  beaker: '<path d="M9 2v6L4 19a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 19L15 8V2Zm2 2h2v4.5l1.6 3.5H9.4L11 8.5Z"/>'
};
function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICONS[name]}</svg>`;
}

const FEATURES: [string, string, string][] = [
  ["key", "Every login method", "Password, magic link, passkeys / WebAuthn, and TOTP + recovery-code MFA — built in, no add-ons or extra vendors."],
  ["shield", "RBAC + ABAC, field-level", "Roles and attribute policies with allow, deny, mask, and readonly effects on individual fields — not just routes."],
  ["building", "Enterprise SSO", "OIDC and SAML with domain-routed sign-in, per-application bindings, and just-in-time account linking."],
  ["db", "Any database", "One engine, any backend — Postgres, SQLite, MySQL, MongoDB and more. Switch with a single line of config."],
  ["pulse", "Dynamic security", "Rate limiting and brute-force protection today; risk-based step-up MFA driven by policy obligations next."],
  ["phone", "Mobile ready", "Passkeys, PKCE, and rotating refresh tokens designed to work the same across web and native apps."],
  ["home", "Local-first, your data", "Users, sessions, policies and audit logs live in your infrastructure. No hosted control plane required."],
  ["beaker", "Trivial to test", "Spin up a full in-memory auth instance with zero external services and assert decisions in a few lines."]
];

const STATS: [string, string][] = [
  ["8", "auth & authz features"],
  ["6+", "databases supported"],
  ["4", "framework adapters"],
  ["3", "ways to integrate"]
];

const LOGOS: string[] = ["NORTHWIND", "ACMECloud", "Globex", "Initech", "Umbra", "Hooli"];

const COMPARISON: { headers: string[]; rows: string[][] } = {
  headers: ["", "Blindfold", "Auth0", "Clerk", "Supabase", "Keycloak"],
  rows: [
    ["Self-host your data", "yes", "limited", "no", "yes", "yes"],
    ["No per-MAU pricing", "yes", "no", "no", "partial", "yes"],
    ["RBAC + ABAC w/ field masking", "yes", "partial", "partial", "partial", "partial"],
    ["Any SQL or NoSQL backend", "yes", "n/a", "n/a", "Postgres", "RDBMS"],
    ["Few-lines drop-in SDK", "yes", "yes", "yes", "yes", "partial"],
    ["MCP / agent-native setup", "yes", "no", "no", "no", "no"],
    ["Open source", "yes", "no", "no", "yes", "yes"]
  ]
};

const PRICING: { name: string; price: string; unit: string; blurb: string; features: string[]; cta: string; highlight: boolean }[] = [
  {
    name: "Open Source",
    price: "$0",
    unit: "forever",
    blurb: "Everything you need to self-host, free.",
    features: ["All login methods + MFA", "RBAC + ABAC, field masking", "Any SQL / NoSQL backend", "CLI, MCP & playground", "Community support"],
    cta: "Start building",
    highlight: false
  },
  {
    name: "Team",
    price: "$49",
    unit: "/ project / mo",
    blurb: "Hosted control plane and collaboration.",
    features: ["Everything in Open Source", "Hosted multi-project control plane", "Studio collaboration & roles", "SSO connections managed", "Priority support"],
    cta: "Start free trial",
    highlight: true
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "talk to us",
    blurb: "Compliance, scale, and white-glove support.",
    features: ["SCIM & lifecycle provisioning", "Audit export & compliance", "On-prem / air-gapped options", "Dedicated support + SLA", "Security review support"],
    cta: "Contact sales",
    highlight: false
  }
];

const TESTIMONIALS: [string, string, string][] = [
  ["We replaced a hosted auth vendor in an afternoon and kept every byte of user data in our own Postgres. The field-level masking alone justified the switch.", "Priya N.", "Staff Engineer, fintech"],
  ["Wiring auth from the CLI — and then from an agent over MCP — felt like cheating. New services get production auth in minutes, not sprints.", "Marcus T.", "Platform Lead, B2B SaaS"],
  ["RBAC and ABAC in one decision call, with an explanation of which rule matched. Our security review was the smoothest we've ever had.", "Dana K.", "Head of Security, healthtech"]
];

const FAQ: [string, string][] = [
  ["Is my user data sent to Blindfold's servers?", "No. Blindfold is local-first — it runs as a package inside your app and stores everything in your own database. There is no hosted control plane required."],
  ["Which databases are supported?", "PostgreSQL, SQLite and MySQL on the SQL side; MongoDB and other document stores on the NoSQL side. Any backend implementing the five-method storage contract works, selected with a single <code>storage:</code> option."],
  ["What does “few lines” actually mean?", "Install <code>@blindfold/client</code>, call <code>blindfold({ project, secret, storage })</code>, and mount the middleware. RBAC/ABAC is one option on a route. The code samples on this page are generated from the real SDK."],
  ["What is the MCP server for?", "It lets an AI agent or IDE create a project, issue keys, define roles and generate the integration snippet for you — wiring auth into a new product conversationally."],
  ["Can I try it without installing anything?", "Yes — the interactive playground lets you log in, evaluate RBAC/ABAC decisions, watch field masking, switch databases, and copy working code for your framework."]
];

/* ---------- fragments ---------- */
const featureCards = FEATURES.map(
  ([ic, title, body], i) =>
    `<article class="card reveal" style="--d:${i * 40}ms"><span class="ico">${icon(ic)}</span><h3>${title}</h3><p>${body}</p></article>`
).join("\n");

const statRow = STATS.map(([n, l]) => `<div class="stat reveal"><div class="n" data-count="${n}">${n}</div><div class="l">${l}</div></div>`).join("");

const logoRow = LOGOS.map((l) => `<span class="logo">${l}</span>`).join("");

const cellClass = (c: string): string => (c === "yes" ? "yes" : c === "no" ? "no" : "mid");
const cellText = (c: string): string => (c === "yes" ? "✓" : c === "no" ? "—" : c);
const comparisonTable = `<div class="tablewrap reveal"><table class="cmp">
<thead><tr>${COMPARISON.headers.map((h, i) => `<th${i === 1 ? ' class="me"' : ""}>${h || "Capability"}</th>`).join("")}</tr></thead>
<tbody>${COMPARISON.rows.map((row) => `<tr>${row.map((c, i) => i === 0 ? `<th>${c}</th>` : `<td class="${i === 1 ? "me " : ""}${cellClass(c)}">${cellText(c)}</td>`).join("")}</tr>`).join("")}</tbody>
</table></div>`;

const tabButtons = SNIPPET_FRAMEWORKS.map((fw: string, i: number) => `<button class="tab${i === 0 ? " active" : ""}" data-fw="${fw}">${fw}</button>`).join("");
const tabPanels = SNIPPET_FRAMEWORKS.map((fw: string, i: number) => `<pre class="code${i === 0 ? " active" : ""}" data-fw="${fw}"><code>${esc(snippets[fw])}</code></pre>`).join("\n");

const pricingCards = PRICING.map(
  (t) => `<article class="price ${t.highlight ? "feat" : ""} reveal">
    ${t.highlight ? '<div class="ribbon">Most popular</div>' : ""}
    <h3>${t.name}</h3>
    <div class="amt"><span class="big">${t.price}</span> <span class="unit">${t.unit}</span></div>
    <p class="blurb">${t.blurb}</p>
    <ul>${t.features.map((f) => `<li>${f}</li>`).join("")}</ul>
    <a class="btn ${t.highlight ? "" : "ghost"}" href="#start">${t.cta}</a>
  </article>`
).join("\n");

const testimonialCards = TESTIMONIALS.map(
  ([quote, name, role]) => `<figure class="quote reveal"><blockquote>“${quote}”</blockquote><figcaption><span class="av">${name.charAt(0)}</span><span><strong>${name}</strong><br/><span class="muted">${role}</span></span></figcaption></figure>`
).join("\n");

const faqItems = FAQ.map(([q, a]) => `<details class="reveal"><summary>${q}</summary><p>${a}</p></details>`).join("\n");

/* ---------- page ---------- */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blindfold Auth — full-featured auth for any app & any database, in a few lines</title>
<meta name="description" content="Drop-in authentication and authorization for any app and any SQL or NoSQL database. Passkeys, MFA, RBAC + ABAC with field masking, SSO, plus a CLI and MCP server. Your data, your infrastructure." />
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#06070d;--bg2:#0a0c16;--panel:rgba(255,255,255,.025);--panel2:rgba(255,255,255,.04);
    --line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.14);
    --fg:#f3f5fb;--muted:#9aa6c4;--faint:#67718f;
    --accent:#6e8bff;--accent2:#a86bff;--cyan:#46e0d0;--ok:#34d399;--bad:#fb7185;--warn:#fcc15a;
    --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    --r:16px;--maxw:1120px;
  }
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{margin:0;font-family:var(--sans);background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased;overflow-x:hidden;}
  body::before{content:"";position:fixed;inset:0;z-index:-2;background:
    radial-gradient(900px 500px at 78% -8%,rgba(110,139,255,.22),transparent 60%),
    radial-gradient(800px 500px at 12% 8%,rgba(168,107,255,.16),transparent 55%),
    radial-gradient(700px 700px at 50% 120%,rgba(70,224,208,.10),transparent 60%),var(--bg);}
  body::after{content:"";position:fixed;inset:0;z-index:-1;opacity:.4;pointer-events:none;
    background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
    background-size:64px 64px;mask-image:radial-gradient(circle at 50% 0,#000,transparent 70%);}
  a{color:inherit;text-decoration:none;}
  .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px;}
  .muted{color:var(--muted);}
  .grad{background:linear-gradient(110deg,var(--accent),var(--accent2) 55%,var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent;}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:6px 13px;}
  .eyebrow .dot{width:7px;height:7px;border-radius:50%;background:var(--cyan);box-shadow:0 0 10px var(--cyan);}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:15px;padding:12px 20px;border-radius:11px;border:1px solid transparent;cursor:pointer;transition:transform .15s,box-shadow .2s,background .2s;
    background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 8px 30px rgba(110,139,255,.32);}
  .btn:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(110,139,255,.45);}
  .btn.ghost{background:var(--panel2);border-color:var(--line2);color:var(--fg);box-shadow:none;}
  .btn.ghost:hover{background:rgba(255,255,255,.07);}
  /* nav */
  nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:rgba(6,7,13,.6);border-bottom:1px solid var(--line);}
  nav .inner{display:flex;align-items:center;gap:26px;max-width:var(--maxw);margin:0 auto;padding:14px 24px;}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:17px;letter-spacing:-.01em;}
  .brand .mk{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;box-shadow:0 4px 16px rgba(110,139,255,.5);}
  .brand .mk svg{width:15px;height:15px;fill:#fff;}
  nav .links{display:flex;gap:22px;}nav .links a{font-size:14px;color:var(--muted);font-weight:500;}nav .links a:hover{color:var(--fg);}
  nav .sp{flex:1;}
  /* hero */
  .hero{padding:84px 0 40px;display:grid;grid-template-columns:1.04fr .96fr;gap:48px;align-items:center;}
  .hero h1{font-size:clamp(34px,5vw,58px);line-height:1.04;letter-spacing:-.03em;font-weight:800;margin:18px 0 18px;}
  .hero .lead{font-size:19px;line-height:1.6;color:var(--muted);max-width:560px;margin:0 0 26px;}
  .hero .cta{display:flex;gap:12px;flex-wrap:wrap;}
  .trust{margin-top:30px;}
  .trust .t{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:12px;}
  .logos{display:flex;flex-wrap:wrap;gap:22px 28px;align-items:center;}
  .logo{font-weight:800;letter-spacing:.02em;color:var(--faint);font-size:15px;opacity:.7;filter:grayscale(1);}
  /* product mock */
  .mock{position:relative;}
  .window{background:linear-gradient(180deg,rgba(20,24,40,.9),rgba(12,15,26,.92));border:1px solid var(--line2);border-radius:18px;box-shadow:0 40px 120px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.02) inset;overflow:hidden;animation:float 7s ease-in-out infinite;}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
  .winbar{display:flex;align-items:center;gap:7px;padding:12px 14px;border-bottom:1px solid var(--line);}
  .winbar i{width:11px;height:11px;border-radius:50%;background:#3a4straight;display:block;}
  .winbar i{background:#39405c;}.winbar .u{margin-left:10px;font-family:var(--mono);font-size:11.5px;color:var(--faint);}
  .winbody{padding:18px;display:grid;gap:12px;}
  .req{font-family:var(--mono);font-size:12.5px;color:var(--muted);background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:11px 13px;}
  .req .k{color:var(--cyan);}
  .decision{border:1px solid var(--line2);border-radius:12px;padding:14px;background:linear-gradient(180deg,rgba(252,193,90,.08),transparent);}
  .decision .top{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
  .badge{font-weight:800;font-size:12px;letter-spacing:.05em;padding:4px 10px;border-radius:999px;}
  .badge.mask{background:rgba(252,193,90,.16);color:var(--warn);border:1px solid rgba(252,193,90,.35);}
  .badge.allow{background:rgba(52,211,153,.16);color:var(--ok);}
  .row{display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-top:1px dashed var(--line);}
  .row:first-of-type{border-top:0;}
  .row .v{font-family:var(--mono);}.row .masked{color:var(--warn);letter-spacing:1px;}
  .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
  .chip{font-family:var(--mono);font-size:11px;color:var(--faint);background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:3px 7px;}
  /* sections */
  section{padding:72px 0;}
  .head{text-align:center;max-width:680px;margin:0 auto 44px;}
  .head h2{font-size:clamp(28px,3.6vw,40px);letter-spacing:-.02em;font-weight:800;margin:14px 0 10px;}
  .head p{color:var(--muted);font-size:17px;margin:0;}
  /* stats */
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
  .stat{text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:24px 12px;}
  .stat .n{font-size:34px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(120deg,var(--accent),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent;}
  .stat .l{color:var(--muted);font-size:13.5px;margin-top:4px;}
  /* features */
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:22px;transition:transform .2s,border-color .2s,background .2s;}
  .card:hover{transform:translateY(-4px);border-color:var(--line2);background:var(--panel2);}
  .card .ico{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,rgba(110,139,255,.25),rgba(168,107,255,.18));border:1px solid var(--line2);margin-bottom:12px;}
  .card .ico svg{fill:var(--fg);}
  .card h3{font-size:16px;margin:0 0 7px;letter-spacing:-.01em;}
  .card p{font-size:13.5px;color:var(--muted);margin:0;line-height:1.55;}
  /* split / code */
  .split{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;}
  .split h2{font-size:clamp(26px,3.2vw,36px);letter-spacing:-.02em;margin:14px 0 12px;font-weight:800;}
  .split p{color:var(--muted);font-size:16px;line-height:1.6;}
  . feat-list{list-style:none;padding:0;margin:16px 0 0;}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
  .tab{font-family:var(--sans);font-weight:600;text-transform:capitalize;background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:9px;padding:8px 15px;cursor:pointer;transition:.15s;}
  .tab.active{color:#fff;border-color:transparent;background:linear-gradient(120deg,var(--accent),var(--accent2));}
  pre{background:linear-gradient(180deg,rgba(12,15,26,.95),rgba(8,10,18,.95));border:1px solid var(--line2);border-radius:14px;padding:18px;overflow:auto;font-family:var(--mono);font-size:12.5px;line-height:1.7;margin:0;box-shadow:0 30px 80px rgba(0,0,0,.4);}
  pre code{color:#cdd6f4;}
  .code{display:none;}.code.active{display:block;animation:fade .3s;}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1}}
  /* flow diagram */
  .flow{max-width:920px;margin:0 auto;}
  .flow svg{width:100%;height:auto;}
  .flow .node{fill:var(--panel2);stroke:var(--line2);}
  .flow .lbl{fill:var(--fg);font:600 13px var(--sans);}
  .flow .sub{fill:var(--muted);font:500 10.5px var(--mono);}
  .flow .wire{stroke:url(#wireg);stroke-width:2;fill:none;stroke-dasharray:6 6;animation:dash 1.4s linear infinite;}
  @keyframes dash{to{stroke-dashoffset:-24;}}
  .flow .pulse{fill:var(--cyan);}
  /* comparison */
  .tablewrap{overflow:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);}
  table.cmp{width:100%;border-collapse:collapse;font-size:14px;min-width:680px;}
  table.cmp th,table.cmp td{padding:13px 14px;border-bottom:1px solid var(--line);text-align:center;}
  table.cmp thead th{color:var(--muted);font-weight:700;font-size:13px;}
  table.cmp tbody th{text-align:left;font-weight:600;color:var(--fg);}
  table.cmp .me{background:linear-gradient(180deg,rgba(110,139,255,.12),transparent);}
  table.cmp thead .me{border-top-left-radius:10px;border-top-right-radius:10px;color:#fff;}
  table.cmp .yes{color:var(--ok);font-weight:800;}
  table.cmp .no{color:var(--faint);}
  table.cmp .mid{color:var(--muted);font-size:12.5px;}
  /* pricing */
  .prices{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:stretch;}
  .price{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px;display:flex;flex-direction:column;}
  .price.feat{border-color:transparent;background:linear-gradient(180deg,rgba(110,139,255,.12),var(--panel));box-shadow:0 0 0 1px rgba(110,139,255,.4),0 30px 80px rgba(110,139,255,.18);}
  .ribbon{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;font-size:11.5px;font-weight:700;padding:5px 12px;border-radius:999px;letter-spacing:.04em;}
  .price h3{margin:0 0 8px;font-size:17px;}
  .price .amt{margin:6px 0 4px;}.price .big{font-size:38px;font-weight:800;letter-spacing:-.02em;}.price .unit{color:var(--muted);font-size:13px;}
  .price .blurb{color:var(--muted);font-size:13.5px;margin:0 0 16px;min-height:38px;}
  .price ul{list-style:none;padding:0;margin:0 0 20px;display:grid;gap:9px;flex:1;}
  .price li{font-size:13.5px;color:var(--fg);padding-left:24px;position:relative;}
  .price li::before{content:"✓";position:absolute;left:0;color:var(--cyan);font-weight:800;}
  .price .btn{justify-content:center;}
  /* testimonials */
  .quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
  .quote{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:22px;}
  .quote blockquote{margin:0 0 16px;font-size:15px;line-height:1.6;}
  .quote figcaption{display:flex;align-items:center;gap:12px;font-size:13px;}
  .quote .av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));}
  /* faq */
  .faq{max-width:760px;margin:0 auto;}
  details{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 18px;margin-bottom:10px;transition:border-color .2s;}
  details[open]{border-color:var(--line2);}
  summary{cursor:pointer;font-weight:600;padding:14px 0;list-style:none;display:flex;justify-content:space-between;align-items:center;}
  summary::after{content:"+";color:var(--muted);font-size:20px;}
  details[open] summary::after{content:"–";}
  details p{color:var(--muted);margin:0 0 14px;line-height:1.6;}
  /* cta band */
  .band{text-align:center;background:linear-gradient(135deg,rgba(110,139,255,.16),rgba(168,107,255,.12));border:1px solid var(--line2);border-radius:24px;padding:54px 24px;}
  .band h2{font-size:clamp(28px,3.6vw,40px);letter-spacing:-.02em;margin:0 0 10px;font-weight:800;}
  .band p{color:var(--muted);font-size:17px;margin:0 0 24px;}
  .band .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
  /* footer */
  footer{border-top:1px solid var(--line);padding:48px 0 36px;margin-top:40px;}
  .fgrid{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:24px;}
  footer h4{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin:0 0 12px;}
  footer a{display:block;color:var(--muted);font-size:14px;margin:7px 0;}footer a:hover{color:var(--fg);}
  .fbtm{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:34px;padding-top:22px;border-top:1px solid var(--line);color:var(--faint);font-size:13px;}
  .note{color:var(--faint);font-size:12.5px;text-align:center;margin-top:14px;}
  /* reveal */
  .reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease;transition-delay:var(--d,0ms);}
  .reveal.in{opacity:1;transform:none;}
  @media(max-width:900px){.hero{grid-template-columns:1fr;}.grid,.stats{grid-template-columns:repeat(2,1fr);}.split{grid-template-columns:1fr;}.prices,.quotes{grid-template-columns:1fr;}.fgrid{grid-template-columns:1fr 1fr;}nav .links{display:none;}}
</style>
</head>
<body>
<nav><div class="inner">
  <a class="brand" href="#"><span class="mk"><svg viewBox="0 0 24 24">${ICONS.shield}</svg></span> Blindfold</a>
  <span class="links">
    <a href="#features">Features</a><a href="#code">Developers</a><a href="#compare">Compare</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
  </span>
  <span class="sp"></span>
  <a class="btn ghost" href="#start" style="padding:9px 16px;font-size:14px;">Get started</a>
</div></nav>

<header class="wrap hero">
  <div>
    <span class="eyebrow"><span class="dot"></span> Auth you own — SDK · CLI · MCP</span>
    <h1>Full-featured auth for <span class="grad">any app &amp; any database</span>, in a few lines.</h1>
    <p class="lead">Passkeys, MFA, RBAC + ABAC with field-level masking, and enterprise SSO — self-hosted in your own infrastructure. Drop it in with an SDK, a CLI, or let an agent wire it up over MCP.</p>
    <div class="cta">
      <a class="btn" href="#start">Start building — free</a>
      <a class="btn ghost" href="#playground">Try the playground</a>
    </div>
    <div class="trust">
      <div class="t">Built for teams that own their stack</div>
      <div class="logos">${logoRow}</div>
    </div>
  </div>
  <div class="mock reveal">
    <div class="window">
      <div class="winbar"><i></i><i></i><i></i><span class="u">blindfold · authorization explorer</span></div>
      <div class="winbody">
        <div class="req"><span class="k">auth.can</span>({ user: <span style="color:#a6e3a1">"bob"</span>, action: <span style="color:#a6e3a1">"read"</span>, resource: <span style="color:#a6e3a1">"customer"</span>, field: <span style="color:#a6e3a1">"ssn"</span> })</div>
        <div class="decision">
          <div class="top"><span class="badge mask">MASK</span><span class="muted" style="font-size:12.5px">allowed · field-level effect</span></div>
          <div class="row"><span>name</span><span class="v">Ada Lovelace</span></div>
          <div class="row"><span>email</span><span class="v">ada@demo.co</span></div>
          <div class="row"><span>ssn</span><span class="v masked">•••-••-1234</span></div>
          <div class="chips"><span class="chip">rule: support.read</span><span class="chip">effect: mask</span><span class="chip">RBAC+ABAC</span></div>
        </div>
      </div>
    </div>
  </div>
</header>

<main>
  <section class="wrap" id="stats" style="padding-top:8px;"><div class="stats">${statRow}</div></section>

  <section class="wrap" id="features">
    <div class="head reveal"><span class="eyebrow">Everything in the box</span><h2>A complete auth runtime, nothing to rent</h2><p>The hard parts of authentication and authorization — already built, and living inside your app.</p></div>
    <div class="grid">${featureCards}</div>
  </section>

  <section class="wrap" id="flow">
    <div class="head reveal"><span class="eyebrow">How it works</span><h2>One engine, the whole flow</h2><p>From login to a field-level authorization decision — in your infrastructure.</p></div>
    <div class="flow reveal">
      <svg viewBox="0 0 920 200" role="img" aria-label="Auth flow diagram">
        <defs><linearGradient id="wireg" x1="0" x2="1"><stop offset="0" stop-color="#6e8bff"/><stop offset="1" stop-color="#46e0d0"/></linearGradient></defs>
        <path class="wire" d="M150 100 H300"/><path class="wire" d="M450 100 H600"/><path class="wire" d="M750 100 H820 V100"/>
        <g><rect class="node" x="20" y="64" width="130" height="72" rx="14"/><text class="lbl" x="85" y="96" text-anchor="middle">Your app</text><text class="sub" x="85" y="116" text-anchor="middle">SDK · 3 lines</text></g>
        <g><rect class="node" x="300" y="48" width="150" height="104" rx="14"/><text class="lbl" x="375" y="86" text-anchor="middle">Blindfold</text><text class="sub" x="375" y="106" text-anchor="middle">passkey · SSO · MFA</text><text class="sub" x="375" y="122" text-anchor="middle">session + rotation</text></g>
        <g><rect class="node" x="600" y="48" width="150" height="104" rx="14"/><text class="lbl" x="675" y="86" text-anchor="middle">Policy engine</text><text class="sub" x="675" y="106" text-anchor="middle">RBAC + ABAC</text><text class="sub" x="675" y="122" text-anchor="middle">allow·deny·mask</text></g>
        <g><rect class="node" x="800" y="64" width="100" height="72" rx="14"/><text class="lbl" x="850" y="96" text-anchor="middle">Your DB</text><text class="sub" x="850" y="116" text-anchor="middle">SQL · NoSQL</text></g>
        <circle class="pulse" cx="225" cy="100" r="4"/><circle class="pulse" cx="525" cy="100" r="4"/>
      </svg>
    </div>
  </section>

  <section class="wrap" id="code">
    <div class="split">
      <div class="reveal">
        <span class="eyebrow">For developers</span>
        <h2>Add auth in a few lines</h2>
        <p>Install the client, point it at your project and database, mount the middleware. Authorization — including field-level masking — is one option on a route.</p>
        <p class="muted" style="font-size:14px;margin-top:14px;">These samples are generated from the real SDK, so they never drift from the actual API. Pick your framework:</p>
      </div>
      <div class="reveal">
        <div class="tabs">${tabButtons}</div>
        ${tabPanels}
      </div>
    </div>
  </section>

  <section class="wrap" id="authz">
    <div class="split">
      <div class="reveal">
        <pre><code>const decision = await auth.can({
  principalId: user.id,
  action: "read",
  resource: "customer",
  field: "ssn",
});

// {
//   allowed: true,
//   effect: "mask",
//   obligations: { maskedFields: ["ssn"], readonlyFields: [] },
//   matchedRuleIds: ["rule_support_read"],
//   reason: "role policy: support",
// }</code></pre>
      </div>
      <div class="reveal">
        <span class="eyebrow">Authorization, all the way down</span>
        <h2>RBAC &amp; ABAC in a single call</h2>
        <p>Roles and attribute rules evaluate together and return <strong>allow</strong>, <strong>deny</strong>, <strong>mask</strong>, or <strong>readonly</strong> — at the level of individual fields, with the exact rule that matched and why. No second authorization layer to build.</p>
      </div>
    </div>
  </section>

  <section class="wrap" id="compare">
    <div class="head reveal"><span class="eyebrow">Why Blindfold</span><h2>Built to own your auth and your data</h2><p>The capabilities teams switch for.</p></div>
    ${comparisonTable}
    <p class="note">Comparison reflects common configurations and is provided for orientation; verify current capabilities with each vendor.</p>
  </section>

  <section class="wrap" id="pricing">
    <div class="head reveal"><span class="eyebrow">Pricing</span><h2>Free to self-host. Pay only for the control plane.</h2><p>Start open source and grow into managed and enterprise when you need it.</p></div>
    <div class="prices">${pricingCards}</div>
    <p class="note">Illustrative pricing for this template — set your own tiers before launch.</p>
  </section>

  <section class="wrap" id="loved">
    <div class="head reveal"><span class="eyebrow">Loved by builders</span><h2>From sprint-long auth projects to minutes</h2><p>What teams say after switching.</p></div>
    <div class="quotes">${testimonialCards}</div>
    <p class="note">Representative testimonials shown for this template.</p>
  </section>

  <section class="wrap" id="playground">
    <div class="band reveal">
      <span class="eyebrow" style="margin-bottom:14px;">Interactive</span>
      <h2>Try the full lifecycle, live</h2>
      <p>Log in, evaluate RBAC/ABAC decisions, watch a field get masked, switch databases, and copy working code.</p>
      <div class="cta">
        <a class="btn" href="#start">Run the playground</a>
        <a class="btn ghost" href="#code">Get the snippet</a>
      </div>
      <pre style="max-width:520px;margin:22px auto 0;text-align:left;"><code>node packages/auth-cli/bin/blindfold-auth.js playground
# → open the printed URL (default http://127.0.0.1:4120)</code></pre>
    </div>
  </section>

  <section class="wrap faq" id="faq">
    <div class="head reveal"><span class="eyebrow">FAQ</span><h2>Questions, answered</h2></div>
    ${faqItems}
  </section>

  <section class="wrap" id="start">
    <div class="band reveal" style="background:linear-gradient(135deg,rgba(70,224,208,.12),rgba(110,139,255,.14));">
      <h2>Own your auth in an afternoon.</h2>
      <p>Open source, self-hosted, and a few lines to integrate.</p>
      <div class="cta"><a class="btn" href="#code">Start building — free</a><a class="btn ghost" href="#pricing">Compare plans</a></div>
    </div>
  </section>
</main>

<footer class="wrap">
  <div class="fgrid">
    <div><a class="brand" href="#"><span class="mk"><svg viewBox="0 0 24 24">${ICONS.shield}</svg></span> Blindfold</a>
      <p class="muted" style="font-size:14px;margin-top:12px;max-width:280px;">Local-first authentication &amp; authorization. Your users, sessions, policies and audit logs — in your infrastructure.</p>
    </div>
    <div><h4>Product</h4><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#playground">Playground</a><a href="#compare">Comparison</a></div>
    <div><h4>Developers</h4><a href="#code">Quickstart</a><a href="#code">SDK</a><a href="#">CLI &amp; MCP</a><a href="#">Storage adapters</a></div>
    <div><h4>Company</h4><a href="#faq">FAQ</a><a href="#">Security</a><a href="#">License (open source)</a><a href="#">Contact</a></div>
  </div>
  <div class="fbtm"><span>© ${new Date().getFullYear()} Blindfold Auth — your data, your infrastructure.</span><span>SDK · CLI · MCP · Playground</span></div>
</footer>
<script>
  // scroll reveal
  const io=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target);}}),{threshold:.12});
  document.querySelectorAll(".reveal").forEach(el=>io.observe(el));
  // code tabs
  document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{
    const fw=tab.dataset.fw;
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t===tab));
    document.querySelectorAll(".code").forEach(c=>c.classList.toggle("active",c.dataset.fw===fw));
  }));
  // stat count-up
  const ce=new IntersectionObserver((es)=>es.forEach(e=>{
    if(!e.isIntersecting)return; const el=e.target; const raw=el.dataset.count; const m=raw.match(/(\\d+)/);
    if(m){const end=+m[1],suf=raw.replace(m[1],"");let n=0;const step=Math.max(1,Math.round(end/24));
      const t=setInterval(()=>{n+=step;if(n>=end){n=end;clearInterval(t);}el.textContent=n+suf;},28);}
    ce.unobserve(el);
  }),{threshold:.6});
  document.querySelectorAll(".stat .n").forEach(el=>ce.observe(el));
</script>
</body>
</html>`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`Wrote ${outFile} (${html.length} bytes), frameworks: ${SNIPPET_FRAMEWORKS.join(", ")}`);

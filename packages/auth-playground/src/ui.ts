/** Single-file playground UI (vanilla JS, no build step). */
export const PLAYGROUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Blindfold Auth — Playground</title>
<style>
  :root { --bg:#0b0f1a; --panel:#141a2b; --line:#243049; --fg:#e7ecf5; --muted:#8b97b0; --accent:#5b8cff; --ok:#34d399; --bad:#fb7185; --mask:#fbbf24; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:18px; margin:0; }
  header .tag { color:var(--muted); font-size:12px; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px 24px; max-width:1200px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
  .panel h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 12px; }
  label { display:block; font-size:12px; color:var(--muted); margin:8px 0 4px; }
  select, input { width:100%; background:#0e1322; color:var(--fg); border:1px solid var(--line); border-radius:7px; padding:8px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:7px; padding:9px 12px; cursor:pointer; font-weight:600; margin-top:10px; }
  button.secondary { background:#22304d; }
  pre { background:#0e1322; border:1px solid var(--line); border-radius:7px; padding:12px; overflow:auto; font-size:12px; }
  .row { display:flex; gap:8px; } .row > * { flex:1; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-weight:700; font-size:12px; }
  .badge.allow { background:rgba(52,211,153,.15); color:var(--ok); }
  .badge.deny { background:rgba(251,113,133,.15); color:var(--bad); }
  .badge.mask { background:rgba(251,191,36,.15); color:var(--mask); }
  .muted { color:var(--muted); }
  .pill { display:inline-block; background:#22304d; border-radius:999px; padding:2px 8px; margin:2px; font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  td,th { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); }
</style>
</head>
<body>
<header>
  <h1>🛡️ Blindfold Auth — Playground</h1>
  <span class="tag" id="storageTag"></span>
  <span style="flex:1"></span>
  <button class="secondary" id="resetBtn">Reset sandbox</button>
</header>
<main>
  <section class="panel">
    <h2>1 · Sign in</h2>
    <div class="row">
      <div><label>Email</label><select id="loginEmail"></select></div>
      <div><label>Password</label><input id="loginPw" value="playground-123" /></div>
    </div>
    <button id="loginBtn">Log in</button>
    <pre id="loginOut" class="muted">No session yet.</pre>
    <button class="secondary" id="revokeBtn">Revoke current session</button>
  </section>

  <section class="panel">
    <h2>2 · Authorization explorer (RBAC + ABAC)</h2>
    <div class="row">
      <div><label>User</label><select id="evalEmail"></select></div>
      <div><label>Action</label><input id="evalAction" value="read" /></div>
    </div>
    <div class="row">
      <div><label>Resource</label><input id="evalResource" value="customer" /></div>
      <div><label>Field (optional)</label><input id="evalField" value="ssn" placeholder="e.g. ssn" /></div>
    </div>
    <button id="evalBtn">Evaluate decision</button>
    <div id="decision" style="margin-top:12px"></div>
    <pre id="decisionRaw"></pre>
  </section>

  <section class="panel">
    <h2>3 · Live state</h2>
    <div id="state">loading…</div>
  </section>

  <section class="panel">
    <h2>4 · Copy-paste integration</h2>
    <div class="row">
      <div><label>Framework</label><select id="fw"></select></div>
      <div><label>Storage</label>
        <select id="storageSel">
          <option value="memory">memory</option>
          <option value="sqlite">sqlite (SQL)</option>
          <option value="postgres">postgres (SQL)</option>
          <option value="mongo">mongo (NoSQL)</option>
        </select>
      </div>
    </div>
    <button id="snippetBtn">Generate snippet</button>
    <pre id="snippet"></pre>
  </section>
</main>
<script>
const api = (path, body) => fetch("/api/" + path, {
  method: body ? "POST" : "GET",
  headers: { "content-type": "application/json" },
  body: body ? JSON.stringify(body) : undefined
}).then(r => r.json());

let lastRefreshToken = null;

function effectBadge(d) {
  const cls = d.allowed ? (d.effect === "mask" ? "mask" : "allow") : "deny";
  const label = d.allowed ? (d.effect ? d.effect.toUpperCase() : "ALLOW") : "DENY";
  return '<span class="badge ' + cls + '">' + label + '</span>';
}

async function refreshState() {
  const s = await api("state");
  document.getElementById("storageTag").textContent = "storage: " + s.storage;
  // populate user dropdowns
  for (const id of ["loginEmail", "evalEmail"]) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = s.users.map(u => '<option>' + u.email + '</option>').join("");
    if (cur) sel.value = cur;
  }
  document.getElementById("state").innerHTML =
    '<p class="muted">App: ' + s.application.name + '</p>' +
    '<p>Roles: ' + s.roles.map(r => '<span class="pill">' + r.name + '</span>').join("") + '</p>' +
    '<p>Policies:</p><table><tr><th>role</th><th>resource</th><th>action</th><th>field</th><th>effect</th></tr>' +
    s.policies.map(p => '<tr><td>' + (p.roleId ? "role" : "-") + '</td><td>' + p.resource + '</td><td>' + p.action + '</td><td>' + (p.field||"*") + '</td><td>' + p.effect + '</td></tr>').join("") +
    '</table>' +
    '<p class="muted">Active sessions: ' + s.sessionCount + ' · recent events: ' + s.audit.length + '</p>';
}

document.getElementById("loginBtn").onclick = async () => {
  const r = await api("login", { email: loginEmail.value, password: loginPw.value });
  lastRefreshToken = r.refreshToken || null;
  document.getElementById("loginOut").textContent =
    r.status === 200 ? "✓ Logged in. Access token: " + (r.accessToken||"").slice(0,24) + "…" : "✗ " + (r.error || r.status);
  refreshState();
};
document.getElementById("revokeBtn").onclick = async () => {
  if (!lastRefreshToken) return;
  await api("revoke", { refreshToken: lastRefreshToken });
  lastRefreshToken = null;
  document.getElementById("loginOut").textContent = "Session revoked.";
  refreshState();
};
document.getElementById("evalBtn").onclick = async () => {
  const d = await api("evaluate", {
    email: evalEmail.value, action: evalAction.value,
    resource: evalResource.value, field: evalField.value || null
  });
  document.getElementById("decision").innerHTML =
    effectBadge(d) + ' <span class="muted">' + (d.reason||"") + '</span>' +
    (d.obligations && (d.obligations.maskedFields||[]).length ? '<br><span class="muted">masked: ' + d.obligations.maskedFields.join(", ") + '</span>' : '');
  document.getElementById("decisionRaw").textContent = JSON.stringify(d, null, 2);
};
document.getElementById("snippetBtn").onclick = async () => {
  const r = await api("snippet", { framework: fw.value, storage: storageSel.value });
  document.getElementById("snippet").textContent = r.code;
};
document.getElementById("resetBtn").onclick = async () => { await api("reset", {}); location.reload(); };

(async function init() {
  const meta = await api("meta");
  fw.innerHTML = meta.frameworks.map(f => '<option>' + f + '</option>').join("");
  await refreshState();
  document.getElementById("snippetBtn").click();
})();
</script>
</body>
</html>`;

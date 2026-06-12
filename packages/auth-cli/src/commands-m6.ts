import { createControlPlane, createFileStore } from "@dmc--98/blindfold-control";
import { generateSnippet, SNIPPET_FRAMEWORKS } from "@dmc--98/blindfold-client";
import { runDoctor } from "@dmc--98/blindfold-mcp/doctor";
import { scanSecurityConfig, hasCriticalFinding } from "./security-scan.js";
import { analyzeSsoMetadata, fetchSsoMetadata } from "./sso-doctor.js";
import { readFileSync } from "node:fs";

interface Io {
  log: (...args: any[]) => void;
}

/**
 * M6 CLI commands: distribution + multi-project key management.
 * These are self-contained (no blindfold.config.js required) so a developer can
 * add auth to a fresh product without first wiring a config.
 */
function readFlag(argv: string[], name: string, fallback: string): string;
function readFlag(argv: string[], name: string, fallback?: string | null): string | null;
function readFlag(argv: string[], name: string, fallback: string | null = null): string | null {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1] || fallback;
}

function controlFor(argv: string[]): any {
  const storePath = readFlag(argv, "--store", "./blindfold.control.json");
  return createControlPlane({ store: createFileStore(storePath) });
}

/** `blindfold add-auth --framework express --project my-app --storage postgres` */
export async function addAuthCommand(argv: string[], io: Io = console): Promise<number> {
  const framework = readFlag(argv, "--framework", "express");
  const project = readFlag(argv, "--project", "my-app");
  const storage = readFlag(argv, "--storage", "postgres");
  if (!SNIPPET_FRAMEWORKS.includes(framework)) {
    io.log(`Unknown framework "${framework}". Supported: ${SNIPPET_FRAMEWORKS.join(", ")}`);
    return 1;
  }
  io.log(`# Add Blindfold Auth to a ${framework} app (project: ${project}, storage: ${storage})`);
  io.log(`# 1) npm i @dmc--98/blindfold-client @dmc--98/blindfold-auth`);
  io.log(`# 2) export BLINDFOLD_SECRET=$(openssl rand -hex 32)`);
  io.log(`# 3) paste:\n`);
  io.log(generateSnippet({ framework, project, storage }));
  return 0;
}

/** `blindfold keys <issue|list|revoke> ...` */
export async function keysCommand(argv: string[], io: Io = console): Promise<number> {
  const sub = argv[1];
  const cp = controlFor(argv);

  if (sub === "issue") {
    const projectRef = readFlag(argv, "--project");
    const env = readFlag(argv, "--env", "live");
    if (!projectRef) {
      io.log("keys issue requires --project <id|slug>");
      return 1;
    }
    const project = cp.projects.get(projectRef) || cp.projects.getBySlug(projectRef);
    if (!project) {
      io.log(`Unknown project: ${projectRef}. Create one with: blindfold project create --name "..."`);
      return 1;
    }
    const key = cp.keys.issue({ projectId: project.id, env });
    io.log(`Issued key for ${project.slug}:`);
    io.log(`  ${key.token}`);
    io.log(`Store it now — it will not be shown again. (id: ${key.id})`);
    return 0;
  }

  if (sub === "list") {
    const projectRef = readFlag(argv, "--project");
    const projectId = projectRef
      ? (cp.projects.get(projectRef) || cp.projects.getBySlug(projectRef))?.id
      : undefined;
    const keys = cp.keys.list({ projectId });
    if (!keys.length) {
      io.log("No keys.");
      return 0;
    }
    for (const k of keys) {
      io.log(`${k.id}  ${k.prefix}…  project=${k.projectId}  ${k.revokedAt ? "REVOKED" : "active"}`);
    }
    return 0;
  }

  if (sub === "revoke") {
    const keyId = argv[2];
    if (!keyId) {
      io.log("keys revoke requires a key id");
      return 1;
    }
    cp.keys.revoke(keyId);
    io.log(`Revoked ${keyId}`);
    return 0;
  }

  io.log("Usage: blindfold keys <issue|list|revoke> [--project <id|slug>] [--store <file>]");
  return 1;
}

/** `blindfold project <create|list> ...` (control-plane project registry) */
export async function projectCommand(argv: string[], io: Io = console): Promise<number> {
  const sub = argv[1];
  const cp = controlFor(argv);

  if (sub === "create") {
    const name = readFlag(argv, "--name");
    const storage = readFlag(argv, "--storage", "postgres");
    if (!name) {
      io.log('project create requires --name "..."');
      return 1;
    }
    const project = cp.projects.create({ name, storage });
    io.log(`Created project ${project.name} (${project.id}, slug=${project.slug}, storage=${storage})`);
    return 0;
  }

  if (sub === "list") {
    const projects = cp.projects.list();
    if (!projects.length) {
      io.log("No projects.");
      return 0;
    }
    for (const p of projects) {
      io.log(`${p.id}  ${p.slug}  storage=${p.storage}`);
    }
    return 0;
  }

  io.log("Usage: blindfold project <create|list> [--name <name>] [--storage <kind>] [--store <file>]");
  return 1;
}

/** `blindfold playground --port 4120 --storage memory` — start the interactive playground. */
export async function playgroundCommand(argv: string[], io: Io = console): Promise<any> {
  const port = Number(readFlag(argv, "--port", "4120"));
  const host = readFlag(argv, "--host", "127.0.0.1");
  const storage = readFlag(argv, "--storage", "memory");
  const { createPlaygroundServer } = await import("@dmc--98/blindfold-playground/server");
  const pg = await createPlaygroundServer({ storage });
  const { url } = await pg.listen(port, host);
  io.log(`Blindfold Playground running at ${url} (storage: ${storage})`);
  // NOTE: the listening server intentionally keeps the event loop alive so
  // `blindfold playground` stays running until interrupted. Programmatic
  // callers (tests/scripts) receive the handle and must call `close()`.
  return pg;
}

/**
 * `blindfold doctor` — two halves of deployment health:
 *  1. runtime smoke (nine-step login/authz sequence proving the integration works)
 *  2. security configuration scan (proving the deployment isn't footgunned)
 * Flags: --security-only skips the smoke. The env map is injectable for tests.
 */
export async function doctorCommand(
  argv: string[],
  io: Io = console,
  env: Record<string, string | undefined> = process.env
): Promise<number> {
  const securityOnly = argv.includes("--security-only");

  let smokeOk = true;
  if (!securityOnly) {
    const report = await runDoctor();
    for (const step of report.steps) {
      io.log(`${step.ok ? "✓" : "✗"} ${step.name}${step.ok ? "" : `  — ${step.error}`}`);
    }
    io.log(`\nSmoke: ${report.passed}/${report.total} checks passed — ${report.ok ? "HEALTHY" : "FAILED"}`);
    smokeOk = report.ok;
  }

  const findings = scanSecurityConfig(env);
  io.log(`\nSecurity configuration scan (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  if (findings.length === 0) {
    io.log("✓ No misconfigurations detected — secrets, database transport, and Studio exposure look hardened.");
  } else {
    for (const f of findings) {
      const icon = f.severity === "critical" ? "✗" : f.severity === "warning" ? "!" : "·";
      io.log(`${icon} [${f.severity}] ${f.code}: ${f.message}`);
      io.log(`    fix: ${f.fix}`);
    }
  }

  const ok = smokeOk && !hasCriticalFinding(findings);
  io.log(`\nDoctor: ${ok ? "HEALTHY" : "FAILED"}`);
  return ok ? 0 : 1;
}

/**
 * `blindfold sso doctor --url <https-metadata-url> | --file <path>`
 * Static IdP metadata checks: cert expiry, https endpoints, PKCE, alg:none,
 * SSO bindings. URL fetches go through the SSRF guard.
 */
export async function ssoCommand(argv: string[], io: Io = console): Promise<number> {
  if (argv[1] !== "doctor") {
    io.log("Usage: blindfold sso doctor --url <metadata-url> | --file <metadata-file>");
    return 1;
  }
  const url = readFlag(argv, "--url");
  const file = readFlag(argv, "--file");
  if (!url && !file) {
    io.log("sso doctor needs --url or --file pointing at IdP metadata (OIDC discovery JSON or SAML metadata XML).");
    return 1;
  }
  let content: string;
  try {
    content = url ? await fetchSsoMetadata(url) : readFileSync(file!, "utf8");
  } catch (error) {
    io.log(`✗ could not load metadata: ${(error as Error).message}`);
    return 1;
  }
  const findings = analyzeSsoMetadata({ content });
  if (findings.length === 0) {
    io.log("✓ Metadata looks healthy: signing material present, endpoints on TLS, no weak algorithms detected.");
    return 0;
  }
  for (const f of findings) {
    const icon = f.severity === "critical" ? "✗" : f.severity === "warning" ? "!" : "·";
    io.log(`${icon} [${f.severity}] ${f.code}: ${f.message}`);
    io.log(`    fix: ${f.fix}`);
  }
  return findings.some((f) => f.severity === "critical") ? 1 : 0;
}

export const M6_COMMANDS: Record<string, (argv: string[], io?: Io) => Promise<any>> = {
  "add-auth": addAuthCommand,
  keys: keysCommand,
  project: projectCommand,
  doctor: doctorCommand,
  sso: ssoCommand,
  playground: playgroundCommand
};

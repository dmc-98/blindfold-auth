import { createHash, randomBytes } from "node:crypto";
import { createMemoryStore, createFileStore } from "./stores.js";
import type { ControlStore } from "./stores.js";

/**
 * @blindfold/control — the multi-project control plane.
 *
 * "One auth system across all my products" is a control-plane trust model, not a
 * single app. This module is the registry: it tracks projects (each maps to a
 * Blindfold workspace + storage choice) and issues per-project API keys so a
 * product can authenticate to its project. Only key *hashes* are persisted; the
 * plaintext token is shown exactly once at issue time.
 *
 *   const cp = createControlPlane({ store: createFileStore("./blindfold.control.json") });
 *   const project = cp.projects.create({ name: "Billing API", storage: "postgres" });
 *   const { token } = cp.keys.issue({ projectId: project.id, env: "live" });
 *   cp.keys.verify(token); // -> { projectId, keyId } | null
 */
export interface Project {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  storage: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  projectId: string;
  env: string;
  label: string | null;
  prefix: string;
  hash: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface CreateProjectOptions {
  name?: string;
  workspaceId?: string;
  storage?: string;
  slug?: string;
}

export interface IssueKeyOptions {
  projectId?: string;
  env?: string;
  label?: string | null;
}

export interface IssuedKey {
  id: string;
  token: string;
  projectId: string;
  env: string;
  prefix: string;
}

export interface VerifyResult {
  projectId: string;
  keyId: string;
  env: string;
}

export interface ControlPlaneOptions {
  store?: ControlStore;
}

function slugify(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createControlPlane({ store }: ControlPlaneOptions = {}) {
  if (!store || typeof store.load !== "function" || typeof store.save !== "function") {
    throw new Error("createControlPlane requires a store with load()/save()");
  }

  const read = () => store.load();
  const commit = (doc: any) => store.save(doc);

  const projects = {
    create({ name, workspaceId, storage = "memory", slug }: CreateProjectOptions = {}): Project {
      if (!name) {
        throw new Error("projects.create requires a name");
      }
      const doc = read();
      const finalSlug = slug || slugify(name);
      const existing = Object.values(doc.projects).find((p: any) => p.slug === finalSlug);
      if (existing) {
        throw new Error(`Project slug "${finalSlug}" already exists`);
      }
      const project: Project = {
        id: id("proj"),
        name,
        slug: finalSlug,
        workspaceId: workspaceId || `workspace_${finalSlug.replace(/-/g, "_")}`,
        storage,
        createdAt: nowIso()
      };
      doc.projects[project.id] = project;
      commit(doc);
      return project;
    },

    list(): Project[] {
      return Object.values(read().projects).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)) as Project[];
    },

    get(projectId: string): Project | null {
      return read().projects[projectId] || null;
    },

    getBySlug(slug: string): Project | null {
      return (Object.values(read().projects).find((p: any) => p.slug === slug) as Project) || null;
    },

    remove(projectId: string): void {
      const doc = read();
      delete doc.projects[projectId];
      // cascade: drop keys for the project
      for (const [keyId, key] of Object.entries(doc.keys)) {
        if ((key as any).projectId === projectId) {
          delete doc.keys[keyId];
        }
      }
      commit(doc);
    }
  };

  const keys = {
    /** Issue a key. Returns the plaintext token ONCE; only the hash is stored. */
    issue({ projectId, env = "live", label = null }: IssueKeyOptions = {}): IssuedKey {
      const doc = read();
      if (!doc.projects[projectId as string]) {
        throw new Error(`Unknown project: ${projectId}`);
      }
      const secret = randomBytes(24).toString("hex");
      const token = `bf_${env}_${secret}`;
      const keyId = id("key");
      doc.keys[keyId] = {
        id: keyId,
        projectId,
        env,
        label,
        prefix: token.slice(0, 12),
        hash: hashToken(token),
        createdAt: nowIso(),
        revokedAt: null,
        lastUsedAt: null
      };
      commit(doc);
      return { id: keyId, token, projectId: projectId as string, env, prefix: doc.keys[keyId].prefix };
    },

    /** Verify a plaintext token. Returns { projectId, keyId } or null. */
    verify(token: string, { touch = false }: { touch?: boolean } = {}): VerifyResult | null {
      if (!token) {
        return null;
      }
      const hash = hashToken(token);
      const doc = read();
      const match = Object.values(doc.keys).find((k: any) => k.hash === hash && !k.revokedAt) as any;
      if (!match) {
        return null;
      }
      if (touch) {
        match.lastUsedAt = nowIso();
        commit(doc);
      }
      return { projectId: match.projectId, keyId: match.id, env: match.env };
    },

    list({ projectId }: { projectId?: string } = {}): any[] {
      const all = Object.values(read().keys).map(({ hash, ...safe }: any) => safe); // never leak hash
      return projectId ? all.filter((k: any) => k.projectId === projectId) : all;
    },

    revoke(keyId: string): { id: string; revokedAt: string } {
      const doc = read();
      if (!doc.keys[keyId]) {
        throw new Error(`Unknown key: ${keyId}`);
      }
      doc.keys[keyId].revokedAt = nowIso();
      commit(doc);
      return { id: keyId, revokedAt: doc.keys[keyId].revokedAt };
    }
  };

  return { projects, keys };
}

export { createMemoryStore, createFileStore } from "./stores.js";

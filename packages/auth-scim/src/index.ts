/**
 * @dmc--98/blindfold-scim — SCIM 2.0 user provisioning + compliance export.
 *
 * Wraps the engine's admin/storage surface as the RFC-7643/7644 endpoints
 * enterprise IdPs (Okta, Entra, Google Workspace) provision against:
 *
 *   GET   /scim/v2/ServiceProviderConfig
 *   GET   /scim/v2/ResourceTypes
 *   GET   /scim/v2/Schemas
 *   GET   /scim/v2/Users               (filter: userName eq "x", count, startIndex)
 *   GET   /scim/v2/Users/{id}
 *   POST  /scim/v2/Users
 *   PATCH /scim/v2/Users/{id}          (PatchOp: active, displayName, name.formatted)
 *   PUT   /scim/v2/Users/{id}          (full replace)
 *   DELETE /scim/v2/Users/{id}         (soft-delete → status=disabled)
 *   GET   /scim/v2/Groups              (mapped from roles; Group members from memberships)
 *
 * Plus a compliance export — `compliance.export({ format })` dumps
 * principals + memberships + audit events for SOC2/GDPR evidence packets.
 *
 * Auth boundary: the package builds protocol handlers; the host mounts them
 * behind whatever bearer/token auth the org uses (typically a SCIM bearer
 * provisioned via `@dmc--98/blindfold-control`).
 */

export const SCIM_VERSION = "1.0.0-rc.1" as const;
export const SCIM_SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  enterpriseUser: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  listResponse: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patchOp: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
  serviceProviderConfig: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  resourceType: "urn:ietf:params:scim:schemas:core:2.0:ResourceType"
} as const;

// --- Engine shape we depend on --------------------------------------------------
export interface ScimEnginePrincipal {
  id: string;
  email: string;
  displayName?: string;
  status: string;
  attributes?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
export interface ScimEngineRole { id: string; applicationId: string; name: string; }
export interface ScimEngineMembership { id: string; principalId: string; applicationId: string; roleId: string; }
export interface ScimEngineAuditEvent { id: string; type: string; createdAt: string; actorId?: string; principalId?: string; data?: unknown; }

export interface ScimEngine {
  admin: {
    principals: {
      list(): Promise<ScimEnginePrincipal[]>;
      create(input: { email: string; password?: string; displayName?: string; actorId?: string }): Promise<ScimEnginePrincipal>;
    };
  };
  storage: {
    get(table: string, id: string): Promise<unknown>;
    list(table: string, filter?: Record<string, unknown>): Promise<unknown[]>;
    put(table: string, record: unknown): Promise<void>;
  };
}

// --- SCIM resource shapes ------------------------------------------------------
export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  displayName?: string;
  name?: { formatted?: string };
  active: boolean;
  meta: { resourceType: "User"; created?: string; lastModified?: string };
  emails: Array<{ value: string; primary?: boolean }>;
}

export interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
  meta: { resourceType: "Group" };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimError {
  schemas: string[];
  status: string;
  scimType?: string;
  detail: string;
}

interface ScimResponse {
  status: number;
  body: object;
}

export interface ScimHandlerInput {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // relative to the SCIM base, e.g. "/Users", "/Users/abc"
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ScimServer {
  readonly version: typeof SCIM_VERSION;
  /** Single entry point — dispatch any SCIM request. */
  handle(input: ScimHandlerInput): Promise<ScimResponse>;
  /** Compliance export — see `ComplianceExportOptions`. */
  compliance: {
    export(opts?: ComplianceExportOptions): Promise<ComplianceExport>;
  };
}

export interface ScimServerOptions {
  auth: ScimEngine;
  /** Optional default password for SCIM-provisioned users (random if omitted). */
  defaultPassword?: () => string;
}

// ------- helpers --------------------------------------------------------------

function principalToScim(p: ScimEnginePrincipal): ScimUser {
  return {
    schemas: [SCIM_SCHEMAS.user],
    id: p.id,
    userName: p.email,
    displayName: p.displayName,
    name: p.displayName ? { formatted: p.displayName } : undefined,
    active: p.status !== "disabled",
    meta: { resourceType: "User", created: p.createdAt, lastModified: p.updatedAt },
    emails: [{ value: p.email, primary: true }]
  };
}

function err(status: number, detail: string, scimType?: string): ScimResponse {
  const body: ScimError = { schemas: [SCIM_SCHEMAS.error], status: String(status), detail };
  if (scimType) body.scimType = scimType;
  return { status, body };
}

function parseFilter(filter?: string): { userName?: string } {
  if (!filter) return {};
  // Minimal subset: SCIM clients use `userName eq "email"` overwhelmingly for sync.
  const m = filter.match(/^userName\s+eq\s+"(.+)"$/i);
  return m ? { userName: m[1] } : {};
}

// --- compliance export --------------------------------------------------------

export interface ComplianceExportOptions {
  /** "json" returns one object with arrays; "ndjson" returns newline-delimited JSON for streaming. */
  format?: "json" | "ndjson";
  /** Filter audit events by ISO timestamp. */
  since?: string;
}

export interface ComplianceExport {
  format: "json" | "ndjson";
  generatedAt: string;
  counts: { principals: number; memberships: number; auditEvents: number };
  /** Single JSON payload when format=json. */
  data?: {
    principals: ScimEnginePrincipal[];
    memberships: ScimEngineMembership[];
    auditEvents: ScimEngineAuditEvent[];
  };
  /** Newline-delimited JSON when format=ndjson — each line `{ kind, record }`. */
  ndjson?: string;
}

// --- main constructor --------------------------------------------------------

export function createScimServer({ auth, defaultPassword }: ScimServerOptions): ScimServer {
  if (!auth || !auth.admin?.principals || !auth.storage) {
    throw new Error("createScimServer requires an auth engine with admin.principals + storage");
  }
  const generatePassword = defaultPassword || (() => "Scim-" + Math.random().toString(36).slice(2, 14) + "-" + Date.now().toString(36));

  async function getPrincipal(id: string): Promise<ScimEnginePrincipal | null> {
    const p = (await auth.storage.get("principals", id)) as ScimEnginePrincipal | null;
    return p || null;
  }

  async function listPrincipalsByEmail(email: string): Promise<ScimEnginePrincipal[]> {
    return (await auth.storage.list("principals", { email: email.toLowerCase() })) as ScimEnginePrincipal[];
  }

  async function writePrincipal(p: ScimEnginePrincipal): Promise<ScimEnginePrincipal> {
    const next = { ...p, updatedAt: new Date().toISOString() };
    await auth.storage.put("principals", next);
    return next;
  }

  function applyPatchOp(p: ScimEnginePrincipal, op: { op: string; path?: string; value?: unknown }): ScimEnginePrincipal {
    const operation = (op.op || "").toLowerCase();
    if (operation !== "replace" && operation !== "add") return p;
    const path = (op.path || "").toLowerCase();
    if (!path && typeof op.value === "object" && op.value) {
      // PatchOp without path — value is a partial resource.
      const v = op.value as Partial<ScimUser> & { active?: boolean };
      const next = { ...p };
      if (typeof v.active === "boolean") next.status = v.active ? "active" : "disabled";
      if (typeof v.displayName === "string") next.displayName = v.displayName;
      return next;
    }
    if (path === "active") return { ...p, status: op.value ? "active" : "disabled" };
    if (path === "displayname") return { ...p, displayName: String(op.value) };
    if (path === "name.formatted") return { ...p, displayName: String(op.value) };
    return p;
  }

  // --- Users handlers ---------------------------------------------------------
  async function listUsers(query: Record<string, string | undefined> = {}): Promise<ScimResponse> {
    const filter = parseFilter(query.filter);
    const all = await auth.admin.principals.list();
    const filtered = filter.userName
      ? all.filter((p) => p.email.toLowerCase() === filter.userName!.toLowerCase())
      : all;
    const startIndex = Math.max(1, Number(query.startIndex || 1));
    const count = Math.max(0, Number(query.count ?? filtered.length));
    const page = filtered.slice(startIndex - 1, startIndex - 1 + count);
    const body: ScimListResponse<ScimUser> = {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults: filtered.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map(principalToScim)
    };
    return { status: 200, body };
  }

  async function getUser(id: string): Promise<ScimResponse> {
    const p = await getPrincipal(id);
    if (!p) return err(404, "User not found");
    return { status: 200, body: principalToScim(p) };
  }

  async function createUser(body: any): Promise<ScimResponse> {
    const userName = body?.userName || body?.emails?.[0]?.value;
    if (!userName) return err(400, "userName is required", "invalidValue");
    const existing = await listPrincipalsByEmail(userName);
    if (existing.length > 0) return err(409, "User already exists", "uniqueness");
    const displayName = body?.displayName || body?.name?.formatted;
    const created = await auth.admin.principals.create({
      email: userName,
      password: body?.password || generatePassword(),
      displayName,
      actorId: "scim"
    });
    // SCIM "active: false" on create → soft-disable immediately.
    if (body?.active === false) {
      const updated = await writePrincipal({ ...created, status: "disabled" });
      return { status: 201, body: principalToScim(updated) };
    }
    return { status: 201, body: principalToScim(created) };
  }

  async function patchUser(id: string, body: any): Promise<ScimResponse> {
    const p = await getPrincipal(id);
    if (!p) return err(404, "User not found");
    const ops = Array.isArray(body?.Operations) ? body.Operations : [];
    let next = p;
    for (const op of ops) next = applyPatchOp(next, op);
    const saved = await writePrincipal(next);
    return { status: 200, body: principalToScim(saved) };
  }

  async function putUser(id: string, body: any): Promise<ScimResponse> {
    const p = await getPrincipal(id);
    if (!p) return err(404, "User not found");
    const next: ScimEnginePrincipal = {
      ...p,
      email: body?.userName || body?.emails?.[0]?.value || p.email,
      displayName: body?.displayName ?? body?.name?.formatted ?? p.displayName,
      status: body?.active === false ? "disabled" : "active"
    };
    const saved = await writePrincipal(next);
    return { status: 200, body: principalToScim(saved) };
  }

  async function deleteUser(id: string): Promise<ScimResponse> {
    const p = await getPrincipal(id);
    if (!p) return err(404, "User not found");
    await writePrincipal({ ...p, status: "disabled" });
    return { status: 204, body: {} };
  }

  // --- Groups handler ---------------------------------------------------------
  async function listGroups(): Promise<ScimResponse> {
    const roles = (await auth.storage.list("roles", {})) as ScimEngineRole[];
    const memberships = (await auth.storage.list("memberships", {})) as ScimEngineMembership[];
    const principals = await auth.admin.principals.list();
    const principalsById = new Map(principals.map((p) => [p.id, p]));
    const groups: ScimGroup[] = roles.map((role) => ({
      schemas: [SCIM_SCHEMAS.group],
      id: role.id,
      displayName: `${role.name} (${role.applicationId})`,
      members: memberships
        .filter((m) => m.roleId === role.id)
        .map((m) => ({ value: m.principalId, display: principalsById.get(m.principalId)?.email })),
      meta: { resourceType: "Group" }
    }));
    return {
      status: 200,
      body: {
        schemas: [SCIM_SCHEMAS.listResponse],
        totalResults: groups.length,
        startIndex: 1,
        itemsPerPage: groups.length,
        Resources: groups
      }
    };
  }

  // --- Groups/{id} handler ----------------------------------------------------
  async function getGroup(id: string): Promise<ScimResponse> {
    const role = (await auth.storage.get("roles", id)) as ScimEngineRole | null;
    if (!role) return err(404, "Group not found");
    const memberships = (await auth.storage.list("memberships", {})) as ScimEngineMembership[];
    const principals = await auth.admin.principals.list();
    const principalsById = new Map(principals.map((p) => [p.id, p]));
    const group: ScimGroup = {
      schemas: [SCIM_SCHEMAS.group],
      id: role.id,
      displayName: `${role.name} (${role.applicationId})`,
      members: memberships
        .filter((m) => m.roleId === role.id)
        .map((m) => ({ value: m.principalId, display: principalsById.get(m.principalId)?.email })),
      meta: { resourceType: "Group" }
    };
    return { status: 200, body: group };
  }

  // --- Discovery --------------------------------------------------------------
  function serviceProviderConfig(): ScimResponse {
    return {
      status: 200,
      body: {
        schemas: [SCIM_SCHEMAS.serviceProviderConfig],
        documentationUri: "https://github.com/blindfold-auth/blindfold/blob/main/packages/auth-scim/README.md",
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          { name: "OAuth Bearer Token", description: "Authentication via OAuth 2.0 bearer token", type: "oauthbearertoken", primary: true }
        ]
      }
    };
  }

  function schemas(): ScimResponse {
    // RFC 7643 §7 — minimal attribute descriptors for User and Group.
    const SCHEMA_URN = "urn:ietf:params:scim:schemas:core:2.0:Schema";
    const userSchema = {
      schemas: [SCHEMA_URN],
      id: SCIM_SCHEMAS.user,
      name: "User",
      description: "Core user account",
      attributes: [
        { name: "userName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "server" },
        { name: "displayName", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "name", type: "complex", multiValued: false, required: false, mutability: "readWrite", returned: "default", uniqueness: "none",
          subAttributes: [
            { name: "formatted", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" }
          ]
        },
        { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", uniqueness: "none",
          subAttributes: [
            { name: "value", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
            { name: "primary", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" }
          ]
        },
        { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "externalId", type: "string", multiValued: false, required: false, caseExact: true, mutability: "readWrite", returned: "default", uniqueness: "none" }
      ],
      meta: { resourceType: "Schema", location: "/Schemas/" + SCIM_SCHEMAS.user }
    };
    const groupSchema = {
      schemas: [SCHEMA_URN],
      id: SCIM_SCHEMAS.group,
      name: "Group",
      description: "Group resource (mapped from roles)",
      attributes: [
        { name: "displayName", type: "string", multiValued: false, required: true, caseExact: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", uniqueness: "none",
          subAttributes: [
            { name: "value", type: "string", multiValued: false, required: false, caseExact: false, mutability: "immutable", returned: "default", uniqueness: "none" },
            { name: "display", type: "string", multiValued: false, required: false, caseExact: false, mutability: "readOnly", returned: "default", uniqueness: "none" }
          ]
        }
      ],
      meta: { resourceType: "Schema", location: "/Schemas/" + SCIM_SCHEMAS.group }
    };
    return {
      status: 200,
      body: {
        schemas: [SCIM_SCHEMAS.listResponse],
        totalResults: 2,
        startIndex: 1,
        itemsPerPage: 2,
        Resources: [userSchema, groupSchema]
      }
    };
  }

  function resourceTypes(): ScimResponse {
    return {
      status: 200,
      body: [
        { schemas: [SCIM_SCHEMAS.resourceType], id: "User", name: "User", endpoint: "/Users", schema: SCIM_SCHEMAS.user },
        { schemas: [SCIM_SCHEMAS.resourceType], id: "Group", name: "Group", endpoint: "/Groups", schema: SCIM_SCHEMAS.group }
      ]
    };
  }

  // --- compliance export ------------------------------------------------------
  async function exportCompliance(opts: ComplianceExportOptions = {}): Promise<ComplianceExport> {
    const format = opts.format || "json";
    const principals = await auth.admin.principals.list();
    const memberships = (await auth.storage.list("memberships", {})) as ScimEngineMembership[];
    let auditEvents = (await auth.storage.list("audit_events", {})) as ScimEngineAuditEvent[];
    if (opts.since) auditEvents = auditEvents.filter((e) => e.createdAt >= opts.since!);
    const out: ComplianceExport = {
      format,
      generatedAt: new Date().toISOString(),
      counts: { principals: principals.length, memberships: memberships.length, auditEvents: auditEvents.length }
    };
    if (format === "ndjson") {
      const lines: string[] = [];
      for (const p of principals) lines.push(JSON.stringify({ kind: "principal", record: p }));
      for (const m of memberships) lines.push(JSON.stringify({ kind: "membership", record: m }));
      for (const e of auditEvents) lines.push(JSON.stringify({ kind: "audit_event", record: e }));
      out.ndjson = lines.join("\n");
    } else {
      out.data = { principals, memberships, auditEvents };
    }
    return out;
  }

  async function handle(input: ScimHandlerInput): Promise<ScimResponse> {
    const method = input.method.toUpperCase();
    const path = input.path.replace(/\/+$/, "");
    try {
      if (path === "/ServiceProviderConfig" && method === "GET") return serviceProviderConfig();
      if (path === "/ResourceTypes" && method === "GET") return resourceTypes();
      if (path === "/Schemas" && method === "GET") return schemas();
      if (path === "/Users" && method === "GET") return listUsers(input.query);
      if (path === "/Users" && method === "POST") return createUser(input.body);
      if (path === "/Groups" && method === "GET") return listGroups();
      const userMatch = path.match(/^\/Users\/([^/]+)$/);
      if (userMatch) {
        const id = userMatch[1]!;
        if (method === "GET") return getUser(id);
        if (method === "PATCH") return patchUser(id, input.body);
        if (method === "PUT") return putUser(id, input.body);
        if (method === "DELETE") return deleteUser(id);
      }
      const groupMatch = path.match(/^\/Groups\/([^/]+)$/);
      if (groupMatch) {
        const id = groupMatch[1]!;
        if (method === "GET") return getGroup(id);
      }
      return err(404, `Unknown SCIM endpoint: ${method} ${path}`);
    } catch (e) {
      return err(500, (e as Error).message);
    }
  }

  return {
    version: SCIM_VERSION,
    handle,
    compliance: { export: exportCompliance }
  };
}

export default createScimServer;

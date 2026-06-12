import { createControlPlane, createMemoryStore } from "@dmc--98/blindfold-control";
import type { Project } from "@dmc--98/blindfold-control";
import { blindfold, generateSnippet, SNIPPET_FRAMEWORKS } from "@dmc--98/blindfold-client";
import { runDoctor } from "./doctor.js";

/**
 * @dmc--98/blindfold-mcp — the agent/IDE distribution surface.
 *
 * Exposes Blindfold as a set of MCP tools so an assistant can wire auth into any
 * product conversationally: create a project, issue a key, define roles, generate
 * the integration snippet, inspect audit, and run a health check. The tool
 * *handlers* are plain async functions (fully testable); `createMcpServer()`
 * binds them to the MCP SDK transport when it is installed.
 *
 *   const tools = createMcpTools({ controlPlane });
 *   await tools.blindfold_create_project.handler({ name: "Billing", storage: "postgres" });
 */
export function createMcpTools(options: Record<string, any> = {}): Record<string, any> {
  const controlPlane =
    options.controlPlane || createControlPlane({ store: options.store || createMemoryStore() });

  // Open a runtime client for a project (default in-memory; real deployments
  // pass a resolver that maps project.storage + secret to a live client).
  // Clients are memoized per project so repeated tool calls share runtime state.
  const baseOpenClient =
    options.openClient ||
    (async (project: Project) =>
      blindfold({
        project: project.workspaceId,
        secret: options.secret || "mcp-dev-secret",
        storage: "memory"
      }));
  const clientCache = new Map<string, any>();
  const openClient = async (project: Project): Promise<any> => {
    if (!clientCache.has(project.id)) {
      clientCache.set(project.id, await baseOpenClient(project));
    }
    return clientCache.get(project.id);
  };

  function requireProject(projectId: string): Project {
    const project = controlPlane.projects.get(projectId) || controlPlane.projects.getBySlug(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return project;
  }

  const tools: Record<string, any> = {
    blindfold_create_project: {
      description: "Create a new Blindfold project (maps to a workspace + storage choice).",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          storage: { type: "string", enum: ["memory", "file", "postgres", "sqlite", "mongo"] }
        }
      },
      async handler({ name, storage = "postgres" }: Record<string, any> = {}) {
        return controlPlane.projects.create({ name, storage });
      }
    },

    blindfold_list_projects: {
      description: "List all Blindfold projects in the control plane.",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        return controlPlane.projects.list();
      }
    },

    blindfold_issue_key: {
      description: "Issue an API key for a project. Returns the token once.",
      inputSchema: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string" },
          env: { type: "string", enum: ["live", "test"] },
          label: { type: "string" }
        }
      },
      async handler({ projectId, env = "live", label }: Record<string, any> = {}) {
        const project = requireProject(projectId);
        return controlPlane.keys.issue({ projectId: project.id, env, label });
      }
    },

    blindfold_revoke_key: {
      description: "Revoke an API key by id.",
      inputSchema: {
        type: "object",
        required: ["keyId"],
        properties: { keyId: { type: "string" } }
      },
      async handler({ keyId }: Record<string, any> = {}) {
        return controlPlane.keys.revoke(keyId);
      }
    },

    blindfold_generate_snippet: {
      description: "Generate the few-lines integration code for a framework.",
      inputSchema: {
        type: "object",
        properties: {
          framework: { type: "string", enum: SNIPPET_FRAMEWORKS },
          projectId: { type: "string" },
          storage: { type: "string" }
        }
      },
      async handler({ framework = "express", projectId, storage }: Record<string, any> = {}) {
        let project: Project | null = null;
        if (projectId) {
          project = requireProject(projectId);
        }
        return {
          framework,
          code: generateSnippet({
            framework,
            project: project?.slug || "my-app",
            storage: storage || project?.storage || "postgres"
          })
        };
      }
    },

    blindfold_define_role: {
      description: "Define a role with permissions on a project's application.",
      inputSchema: {
        type: "object",
        required: ["projectId", "applicationId", "name"],
        properties: {
          projectId: { type: "string" },
          applicationId: { type: "string" },
          name: { type: "string" },
          permissions: { type: "array" }
        }
      },
      async handler({ projectId, applicationId, name, permissions = [] }: Record<string, any> = {}) {
        const project = requireProject(projectId);
        const client = await openClient(project);
        const role = await client.admin.roles.create({ applicationId, name });
        for (const perm of permissions) {
          await client.admin.roles.grantPermission({
            applicationId,
            roleId: role.id,
            resource: perm.resource,
            action: perm.action,
            effect: perm.effect
          });
        }
        return role;
      }
    },

    blindfold_doctor: {
      description: "Run the nine-step auth smoke check and report pass/fail.",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        return runDoctor();
      }
    }
  };

  return tools;
}

/** List tool metadata (name + description + schema) for MCP tools/list. */
export function listToolDefs(tools: Record<string, any>): Array<Record<string, any>> {
  return Object.entries(tools).map(([name, def]: [string, any]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema
  }));
}

/**
 * Bind the tools to an MCP stdio server. Requires the optional dependency
 * `@modelcontextprotocol/sdk`. Kept thin and import-guarded so the package
 * (and its tool handlers) work and test without the SDK present.
 */
export async function createMcpServer(options: Record<string, any> = {}): Promise<Record<string, any>> {
  let sdk: any;
  try {
    // Optional peer dep — resolved through a variable so the type-checker
    // doesn't require it installed at build time (runtime string unchanged).
    const sdkSpecifier = "@modelcontextprotocol/sdk/server/mcp.js";
    sdk = await import(sdkSpecifier);
  } catch {
    throw new Error(
      "createMcpServer needs @modelcontextprotocol/sdk installed. Run: npm i @modelcontextprotocol/sdk"
    );
  }
  const { McpServer } = sdk;
  const tools = createMcpTools(options);
  const server = new McpServer({ name: "blindfold-auth", version: "0.1.0" });
  for (const [name, def] of Object.entries(tools) as [string, any][]) {
    server.tool(name, def.description, def.inputSchema, async (args: any) => {
      const result = await def.handler(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
  }
  return { server, tools };
}

export { runDoctor } from "./doctor.js";

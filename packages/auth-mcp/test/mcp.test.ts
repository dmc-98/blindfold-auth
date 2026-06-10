import { test } from "node:test";
import assert from "node:assert";
import { createMcpTools, listToolDefs, runDoctor } from "../src/index.js";
import { generateSnippet, SNIPPET_FRAMEWORKS } from "@blindfold/client";

test("generateSnippet produces few-lines code per framework", () => {
  for (const fw of SNIPPET_FRAMEWORKS) {
    const code = generateSnippet({ framework: fw, project: "p", storage: "postgres" });
    assert.match(code, /@blindfold\/client/);
    assert.ok(code.length > 50);
  }
  assert.throws(() => generateSnippet({ framework: "django" }), /Unknown framework/);
});

test("MCP tools: create project, list, issue key, generate snippet", async () => {
  const tools = createMcpTools();

  const project = await tools.blindfold_create_project.handler({ name: "Billing", storage: "sqlite" });
  assert.equal(project.slug, "billing");

  const list = await tools.blindfold_list_projects.handler({});
  assert.equal(list.length, 1);

  const key = await tools.blindfold_issue_key.handler({ projectId: project.id, env: "test" });
  assert.match(key.token, /^bf_test_/);

  const snippet = await tools.blindfold_generate_snippet.handler({
    framework: "express",
    projectId: project.id
  });
  assert.equal(snippet.framework, "express");
  assert.match(snippet.code, /billing/);
});

test("MCP define_role wires roles through a project's cached runtime client", async () => {
  // Inject a shared in-memory client so we can bootstrap an app, then define a
  // role against it through the MCP tool — proving the cached-client wiring.
  const { blindfold } = await import("@blindfold/client");
  const shared = await blindfold({ project: "role_ws", secret: "s", storage: "memory" });
  await shared.admin.bootstrapWorkspace({ name: "Role WS" });
  const app = await shared.admin.applications.create({ slug: "role-app", name: "Role App" });

  const tools = createMcpTools({ openClient: async () => shared });
  const project = await tools.blindfold_create_project.handler({ name: "RoleApp", storage: "memory" });

  const role = await tools.blindfold_define_role.handler({
    projectId: project.id,
    applicationId: app.id,
    name: "editor",
    permissions: [{ resource: "doc", action: "write" }]
  });
  assert.ok(role.id);

  // The role + permission are persisted in the shared client.
  const roles = await shared.admin.roles.list({ applicationId: app.id });
  assert.ok(roles.find((r: any) => r.name === "editor"));

  await assert.rejects(
    () => tools.blindfold_define_role.handler({ projectId: "proj_nope", applicationId: app.id, name: "x" }),
    /Unknown project/
  );
});

test("listToolDefs exposes name/description/schema for tools/list", () => {
  const defs = listToolDefs(createMcpTools());
  assert.ok(defs.length >= 6);
  for (const def of defs) {
    assert.equal(typeof def.name, "string");
    assert.equal(typeof def.description, "string");
    assert.equal(typeof def.inputSchema, "object");
  }
});

test("runDoctor passes the nine-step smoke on a fresh in-memory client", async () => {
  const report = await runDoctor();
  assert.equal(report.ok, true, JSON.stringify(report.steps));
  assert.equal(report.passed, report.total);
  assert.ok(report.total >= 9);
});

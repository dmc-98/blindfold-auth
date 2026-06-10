/**
 * Integration snippet generator.
 *
 * Produces the few-lines code needed to wire Blindfold into a given framework.
 * Used by the CLI (`blindfold add-auth`) and the MCP `generate_snippet` tool so
 * the "few lines of code" promise is something a human or an agent can paste.
 */
const FRAMEWORKS = ["express", "fastify", "hono", "next"];

function header(project: string, storage: string): string[] {
  return [
    `import { blindfold } from "@blindfold/client";`,
    ``,
    `const auth = await blindfold({`,
    `  project: ${JSON.stringify(project)},`,
    `  secret: process.env.BLINDFOLD_SECRET,`,
    `  storage: ${JSON.stringify(storage)},`,
    `});`
  ];
}

export function generateSnippet({ framework = "express", project = "my-app", storage = "postgres" }: { framework?: string; project?: string; storage?: string } = {}): string {
  const fw = String(framework).toLowerCase();
  if (!FRAMEWORKS.includes(fw)) {
    throw new Error(`Unknown framework "${framework}". Supported: ${FRAMEWORKS.join(", ")}`);
  }

  const lines = header(project, storage);

  if (fw === "express") {
    lines.push(
      ``,
      `import express from "express";`,
      `import { blindfoldExpress, guard } from "@blindfold/client/express";`,
      ``,
      `const app = express();`,
      `app.use(express.json());`,
      `app.use(blindfoldExpress(auth));                       // mounts POST /auth/login, /refresh, /logout, /magic-link`,
      ``,
      `// Protect a route with RBAC/ABAC (field-level effects supported):`,
      `app.get("/invoices",`,
      `  guard(auth, { resource: "invoice", action: "read" }),`,
      `  (req, res) => res.json({ user: req.auth.subject.id }));`,
      ``,
      `app.listen(3000);`
    );
  } else if (fw === "fastify") {
    lines.push(
      ``,
      `import Fastify from "fastify";`,
      `const app = Fastify();`,
      ``,
      `app.post("/auth/login", async (req, reply) => {`,
      `  const r = await auth.handlers.login()({ body: req.body, headers: req.headers });`,
      `  reply.code(r.statusCode).send(JSON.parse(r.body));`,
      `});`,
      ``,
      `app.get("/invoices", async (req, reply) => {`,
      `  const handler = auth.protect({ resource: "invoice", action: "read" },`,
      `    async (ctx) => ({ statusCode: 200, body: { user: ctx.subject.id } }));`,
      `  const r = await handler({ headers: req.headers });`,
      `  reply.code(r.statusCode).send(r.body);`,
      `});`,
      ``,
      `app.listen({ port: 3000 });`
    );
  } else if (fw === "hono") {
    lines.push(
      ``,
      `import { Hono } from "hono";`,
      `const app = new Hono();`,
      ``,
      `app.post("/auth/login", async (c) => {`,
      `  const r = await auth.handlers.login()({ body: await c.req.json(), headers: c.req.header() });`,
      `  return c.json(JSON.parse(r.body), r.statusCode);`,
      `});`,
      ``,
      `app.get("/invoices", async (c) => {`,
      `  const handler = auth.protect({ resource: "invoice", action: "read" },`,
      `    async (ctx) => ({ statusCode: 200, body: { user: ctx.subject.id } }));`,
      `  const r = await handler({ headers: c.req.header() });`,
      `  return c.json(r.body, r.statusCode);`,
      `});`,
      ``,
      `export default app;`
    );
  } else if (fw === "next") {
    lines.push(
      ``,
      `// app/api/auth/login/route.js`,
      `export async function POST(request) {`,
      `  const body = await request.json();`,
      `  const r = await auth.handlers.login()({ body, headers: Object.fromEntries(request.headers) });`,
      `  return new Response(r.body, { status: r.statusCode, headers: r.headers });`,
      `}`,
      ``,
      `// Protect a server route/action:`,
      `// const handler = auth.protect({ resource: "invoice", action: "read" }, fn);`
    );
  }

  return lines.join("\n");
}

export { FRAMEWORKS as SNIPPET_FRAMEWORKS };

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSandbox } from "./sandbox.js";
import { PLAYGROUND_HTML } from "./ui.js";
import { SNIPPET_FRAMEWORKS } from "@blindfold/client";

/**
 * Playground HTTP server. Serves the single-file UI and a small JSON API backed
 * by a live sandbox. Designed so the API layer is independently testable via
 * `handleRequest` without binding a socket.
 */
async function readBody(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/** Pure-ish request handler: (method, path, body, ctx) -> { status, json|html }. */
export async function handleApi(action: string, body: Record<string, any>, ctx: Record<string, any>): Promise<Record<string, any>> {
  const { sandbox } = ctx;
  switch (action) {
    case "meta":
      return { status: 200, json: { frameworks: SNIPPET_FRAMEWORKS, storage: ctx.storage } };
    case "state":
      return { status: 200, json: await sandbox.getState() };
    case "login":
      return { status: 200, json: await sandbox.login(body) };
    case "evaluate":
      return { status: 200, json: await sandbox.evaluate(body) };
    case "snippet":
      return { status: 200, json: sandbox.snippet(body) };
    case "revoke":
      return { status: 200, json: await sandbox.revokeSession(body) };
    case "reset":
      await ctx.reset();
      return { status: 200, json: { ok: true } };
    default:
      return { status: 404, json: { error: "unknown action: " + action } };
  }
}

export async function createPlaygroundServer(options: Record<string, any> = {}): Promise<Record<string, any>> {
  const storage = options.storage || "memory";
  const ctx: Record<string, any> = { storage, sandbox: await createSandbox({ storage, storageOptions: options.storageOptions }) };
  ctx.reset = async () => {
    ctx.sandbox = await createSandbox({ storage, storageOptions: options.storageOptions });
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url as string, "http://localhost");
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(PLAYGROUND_HTML);
      }
      if (url.pathname.startsWith("/api/")) {
        const action = url.pathname.slice(5);
        const body = req.method === "POST" ? await readBody(req) : {};
        const result = await handleApi(action, body, ctx);
        res.writeHead(result.status, { "content-type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(result.json));
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  return {
    server,
    ctx,
    listen(port = 4120, host = "127.0.0.1"): Promise<Record<string, any>> {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const actual = server.address();
          const boundPort = typeof actual === "object" && actual ? actual.port : port;
          resolve({ url: `http://${host}:${boundPort}`, port: boundPort });
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

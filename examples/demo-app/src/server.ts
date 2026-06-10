import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, CreateAppOptions } from "./app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Public assets live next to the package root (not under dist/) so they're shared
// between the TS source layout and the compiled output.
const INDEX = readFileSync(resolve(__dirname, "../../public/index.html"), "utf8");

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  res.writeHead(status, { "content-type": type + "; charset=utf-8" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : (body as string));
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress || "unknown";
}

function clientDeviceId(req: IncomingMessage, body: Record<string, unknown>): string {
  const h = req.headers["x-device-id"];
  if (typeof h === "string" && h) return h;
  if (typeof body.deviceId === "string" && body.deviceId) return body.deviceId;
  return "unknown";
}

export async function createDemoServer(options: CreateAppOptions = {}) {
  const { api } = await createApp(options);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const { pathname } = url;
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return send(res, 200, INDEX, "text/html");

      if (req.method === "POST" && pathname === "/auth/login") {
        const body = await readJson(req);
        const r = await api.login({
          email: String(body.email || ""),
          password: String(body.password || ""),
          deviceId: clientDeviceId(req, body),
          ip: clientIp(req)
        });
        return send(res, r.status, r.body);
      }
      if (req.method === "POST" && pathname === "/auth/mfa/verify") {
        const body = await readJson(req);
        const r = await api.verifyMfa({ challengeId: String(body.challengeId || ""), code: String(body.code || "") });
        return send(res, r.status, r.body);
      }
      if (req.method === "GET" && pathname === "/api/me") {
        const r = await api.me(req.headers);
        return send(res, r.status, r.body);
      }
      if (req.method === "GET" && pathname === "/api/customers") {
        const r = await api.customers(req.headers);
        return send(res, r.status, r.body);
      }
      const del = pathname.match(/^\/api\/customers\/([^/]+)$/);
      if (req.method === "DELETE" && del) {
        const r = await api.deleteCustomer(req.headers, del[1]!);
        return send(res, r.status, r.body);
      }
      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 500, { error: (error as Error).message });
    }
  });

  return {
    server,
    api,
    listen(port = 4130, host = "127.0.0.1"): Promise<{ url: string; port: number }> {
      return new Promise((r) => server.listen(port, host, () => {
        const a = server.address();
        const p = typeof a === "object" && a ? a.port : port;
        r({ url: `http://${host}:${p}`, port: p });
      }));
    },
    close(): Promise<void> { return new Promise((r) => server.close(() => r())); }
  };
}

function pathToFileUrlSafe(p: string): string {
  try { return new URL(`file://${resolve(p)}`).href; } catch { return ""; }
}

if (import.meta.url === pathToFileUrlSafe(process.argv[1] || "")) {
  const port = Number(process.env.PORT || 4130);
  const { listen } = await createDemoServer({ storage: process.env.STORAGE || "memory" });
  const { url } = await listen(port);
  console.log(`\n  Acme Support Console (Blindfold Auth demo) → ${url}`);
  console.log("  Sign in: alice@acme.co / password123 (admin)  ·  bob@acme.co / password123 (support)\n");
}

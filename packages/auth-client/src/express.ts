/**
 * Express adapter for @blindfold/client.
 *
 * Translates Express req/res into the normalized request/response shape the
 * Blindfold runtime expects, and mounts the prebuilt auth routes. Keeps app
 * integration to a few lines:
 *
 *   import express from "express";
 *   import { blindfold } from "@blindfold/client";
 *   import { blindfoldExpress } from "@blindfold/client/express";
 *
 *   const auth = await blindfold({ project: "my-app", secret });
 *   const app = express();
 *   app.use(express.json());
 *   app.use(blindfoldExpress(auth));                         // mounts /auth/*
 *   app.get("/admin", auth.express.guard({ resource: "billing", action: "read" }),
 *     (req, res) => res.json({ user: req.auth.subject.id }));
 */

function toNormalizedRequest(req: any): Record<string, any> {
  return {
    headers: req.headers || {},
    body: req.body ?? null,
    method: req.method,
    path: req.path || req.url,
    query: req.query || {},
    params: req.params || {},
    ip: req.ip || req.socket?.remoteAddress || null,
    rawRequest: req
  };
}

function sendNormalizedResponse(res: any, result: any): any {
  const statusCode = result?.statusCode ?? 200;
  const headers = result?.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  const body = result?.body;
  if (body == null) {
    return res.status(statusCode).end();
  }
  if (typeof body === "string") {
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    return res.status(statusCode).send(body);
  }
  return res.status(statusCode).json(body);
}

/** Adapt a normalized-request handler into an Express middleware. */
export function adaptHandler(handler: any) {
  return async function expressHandler(req: any, res: any, next: any) {
    try {
      const result = await handler(toNormalizedRequest(req));
      return sendNormalizedResponse(res, result);
    } catch (error) {
      return next ? next(error) : sendNormalizedResponse(res, { statusCode: 500, body: { error: (error as Error).message } });
    }
  };
}

/**
 * Build an Express Router that mounts the standard auth endpoints and attaches
 * convenience helpers on the returned router (`.guard`).
 *
 * @param {object} client - the object returned by blindfold()
 * @param {object} [options]
 * @param {string} [options.prefix="/auth"]
 */
export function blindfoldExpress(client: any, options: Record<string, any> = {}): any {
  const prefix = options.prefix ?? "/auth";

  // Lazy require so apps that don't use Express don't pay for it.
  const router = options.router || createMinimalRouter();

  router.post(`${prefix}/login`, adaptHandler(client.handlers.login()));
  router.post(`${prefix}/refresh`, adaptHandler(client.handlers.refresh()));
  router.post(`${prefix}/logout`, adaptHandler(client.handlers.logout()));
  router.post(`${prefix}/magic-link`, adaptHandler(client.handlers.requestMagicLink()));
  router.post(`${prefix}/magic-link/consume`, adaptHandler(client.handlers.consumeMagicLink()));

  return router;
}

/**
 * A guard middleware: verifies the session (and optional RBAC/ABAC decision),
 * attaches `req.auth = { subject, session, application, decision }`, then calls
 * next(). Responds 401/403 directly on failure.
 */
export function guard(client: any, guardOptions: Record<string, any> = {}) {
  const protectedHandler = client.protect(guardOptions, async (ctx: any) => ({
    statusCode: 200,
    body: { ok: true, _ctx: ctx }
  }));

  return async function guardMiddleware(req: any, res: any, next: any) {
    const result = await protectedHandler(toNormalizedRequest(req));
    if (result.statusCode >= 400) {
      return sendNormalizedResponse(res, result);
    }
    const ctx = result.body?._ctx;
    req.auth = {
      subject: ctx?.subject || null,
      session: ctx?.session || null,
      application: ctx?.application || null,
      decision: ctx?.decision || null
    };
    return next();
  };
}

// Minimal router shim used only when Express isn't passed in (keeps this file
// dependency-free and unit-testable without Express installed).
function createMinimalRouter(): any {
  const routes: any[] = [];
  const make = (method: string) => (path: string, handler: any) => {
    routes.push({ method: method.toUpperCase(), path, handler });
  };
  return {
    routes,
    get: make("get"),
    post: make("post"),
    put: make("put"),
    delete: make("delete"),
    /** Dispatch a normalized request through the registered routes (for tests). */
    async dispatch(method: string, path: string, req: any) {
      const route = routes.find((r) => r.method === method.toUpperCase() && r.path === path);
      if (!route) {
        return { statusCode: 404, body: { error: "route not found" } };
      }
      let captured: any = null;
      const res = makeFakeRes((r: any) => {
        captured = r;
      });
      await route.handler(req, res, (err: any) => {
        captured = { statusCode: 500, body: { error: err?.message || "error" } };
      });
      return captured;
    }
  };
}

function makeFakeRes(onSend: (r: any) => void): any {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 200,
    getHeader: (k: string) => headers[k.toLowerCase()],
    setHeader: (k: string, v: any) => {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(obj: any) {
      onSend({ statusCode: res.statusCode, headers, body: obj });
      return res;
    },
    send(str: any) {
      onSend({ statusCode: res.statusCode, headers, body: str });
      return res;
    },
    end() {
      onSend({ statusCode: res.statusCode, headers, body: null });
      return res;
    }
  };
  return res;
}

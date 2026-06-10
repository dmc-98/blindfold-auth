function normalizePath(event: any): string {
  return event.rawPath || event.path || event.requestContext?.http?.path || "/";
}

function normalizeMethod(event: any): string {
  return event.requestContext?.http?.method || event.httpMethod || "GET";
}

function normalizeHeaders(event: any): Record<string, any> {
  return event.headers || {};
}

function normalizeBody(event: any): any {
  if (!event.body) {
    return null;
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function routeKey(method: string, path: string): string {
  return `${String(method).toUpperCase()} ${path}`;
}

function createNotFoundResponse(): any {
  return {
    statusCode: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: "route not found" })
  };
}

export function createApiGatewayHandler({ routes }: { routes: Record<string, any> }) {
  return async function apiGatewayHandler(event: any = {}, lambdaContext: any = {}) {
    const method = normalizeMethod(event);
    const path = normalizePath(event);
    const handler = routes[routeKey(method, path)];
    if (!handler) {
      return createNotFoundResponse();
    }

    const response = await handler({
      body: normalizeBody(event),
      headers: normalizeHeaders(event),
      method,
      path,
      query: event.queryStringParameters || {},
      params: event.pathParameters || {},
      ip: event.requestContext?.http?.sourceIp || null,
      lambdaContext,
      rawEvent: event
    });

    return {
      statusCode: response.statusCode ?? 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(response.headers || {})
      },
      body: typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {})
    };
  };
}

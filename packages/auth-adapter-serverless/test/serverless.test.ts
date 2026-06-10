import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "@blindfold/auth";
import { createApiGatewayHandler } from "../src/index.js";

test("Serverless adapter wraps API Gateway routes and protected handlers", async () => {
  const auth = createAuth({
    workspaceId: "workspace_lambda",
    secret: "lambda-secret",
    storage: createMemoryStorage()
  });

  await auth.admin.bootstrapWorkspace({ name: "Lambda Workspace" });
  const application = await auth.admin.applications.create({
    slug: "lambda-app",
    name: "Lambda App"
  });
  const principal = await auth.admin.principals.create({
    displayName: "Lambda Admin",
    email: "lambda@example.com",
    password: "lambda-password"
  });
  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "reader"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "billing",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const handler = createApiGatewayHandler({
    routes: {
      "POST /auth/login": auth.handlers.login(),
      "GET /billing": auth.protect(
        {
          applicationId: application.id,
          resource: "billing",
          action: "read"
        },
        async ({ subject }: any) => ({
          statusCode: 200,
          body: JSON.stringify({ principalId: subject.id })
        })
      )
    }
  });

  const login = await handler({
    rawPath: "/auth/login",
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({
      applicationId: application.id,
      email: principal.email,
      password: "lambda-password"
    })
  });
  const loginPayload = JSON.parse(login.body);
  assert.equal(login.statusCode, 200);

  const billing = await handler({
    rawPath: "/billing",
    requestContext: { http: { method: "GET" } },
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`
    }
  });
  assert.equal(billing.statusCode, 200);
  assert.equal(JSON.parse(billing.body).principalId, principal.id);
});

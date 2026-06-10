import { createAuth } from "@blindfold/auth";
import { createApiGatewayHandler } from "@blindfold/auth-adapter-serverless";
import { createDynamoReferenceStore } from "./dynamo-reference-store.js";

function createInMemoryDynamoClient() {
  const tables = new Map<string, Map<string, any>>();

  return {
    async get({ tableName, key }: { tableName: string; key: { id: string } }) {
      const table = tables.get(tableName) || new Map<string, any>();
      return { item: table.get(key.id) || null };
    },
    async put({ tableName, item }: { tableName: string; item: any }) {
      const table = tables.get(tableName) || new Map<string, any>();
      table.set(item.id, item);
      tables.set(tableName, table);
    },
    async delete({ tableName, key }: { tableName: string; key: { id: string } }) {
      const table = tables.get(tableName) || new Map<string, any>();
      table.delete(key.id);
      tables.set(tableName, table);
    },
    async scan({ tableName }: { tableName: string }) {
      const table = tables.get(tableName) || new Map<string, any>();
      return { items: [...table.values()] };
    }
  };
}

const auth = createAuth({
  workspaceId: "workspace_lambda_demo",
  secret: "blindfold-lambda-secret",
  storage: createDynamoReferenceStore({
    client: createInMemoryDynamoClient(),
    tablePrefix: "blindfold_demo"
  })
});

await auth.admin.bootstrapWorkspace({ name: "Blindfold Lambda Demo" });
const application = await auth.admin.applications.create({
  slug: "serverless-app",
  name: "Serverless App"
});
const principal = await auth.admin.principals.create({
  displayName: "Lambda Admin",
  email: "lambda@example.com",
  password: "lambda-password-123",
  attributes: { department: "platform" }
});
const role = await auth.admin.roles.create({
  applicationId: application.id,
  name: "operator"
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

export const lambdaDemoContext = {
  applicationId: application.id,
  principalEmail: principal.email,
  principalPassword: "lambda-password-123"
};

export const handler = createApiGatewayHandler({
  routes: {
    "POST /auth/login": auth.handlers.login(),
    "POST /auth/refresh": auth.handlers.refresh(),
    "POST /auth/logout": auth.handlers.logout(),
    "GET /billing": auth.protect(
      {
        applicationId: application.id,
        resource: "billing",
        action: "read"
      },
      async ({ subject }: any) => ({
        statusCode: 200,
        body: JSON.stringify({
          message: "Billing route protected by Blindfold Auth",
          principal: {
            id: subject.id,
            email: subject.email
          }
        })
      })
    )
  }
});

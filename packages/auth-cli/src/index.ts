import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startStudio } from "@dmc--98/blindfold-auth-studio";
import { M6_COMMANDS } from "./commands-m6.js";

interface Io {
  log: (...args: any[]) => void;
}

function helpText(): string {
  return `Blindfold Auth CLI

Commands:
  help
    Show this help text

  studio --config ./blindfold.config.js --host 127.0.0.1 --port 4110
    Start Blindfold Studio locally

  bootstrap --config ./blindfold.config.js --workspace-name "Blindfold Workspace"
    Bootstrap a workspace through the configured auth instance

  seed-demo --config ./blindfold.config.js
    Seed a demo application, principal, role, and policy

  seed-launch-demo --config ./blindfold.config.js
    Seed passkey-first, OIDC, and SAML launch-ready demo data

  migrate --config ./blindfold.config.js [--dry-run]
    Apply migrations or print the migration plan when the config exports migrate({ auth, dryRun })

  add-auth --framework express --project my-app --storage postgres
    Print a few-lines integration snippet for a framework (no config needed)

  project create --name "My App" --storage postgres   |   project list
    Manage control-plane projects (multi-project registry)

  keys issue --project my-app   |   keys list   |   keys revoke <keyId>
    Issue, list, or revoke per-project API keys (stored hashed)

  doctor
    Run the nine-step auth smoke check and report health

  playground --port 4120 --storage memory
    Start the interactive in-browser playground (login, RBAC/ABAC, masking, snippets)`;
}

function readFlag(argumentsList: string[], name: string, fallback: string): string;
function readFlag(argumentsList: string[], name: string, fallback?: string | null): string | null;
function readFlag(argumentsList: string[], name: string, fallback: string | null = null): string | null {
  const index = argumentsList.indexOf(name);
  if (index < 0) {
    return fallback;
  }

  return argumentsList[index + 1] || fallback;
}

async function loadConfigModule(configPath: string | null): Promise<{ module: any; resolvedPath: string }> {
  const resolvedPath = resolve(process.cwd(), configPath || "./blindfold.config.js");
  const module = await import(pathToFileURL(resolvedPath).href);
  return { module, resolvedPath };
}

function loadAuthFromModule(loadedConfig: { module: any; resolvedPath: string }, configPath: string | null): any {
  const { module, resolvedPath } = loadedConfig;
  const candidate = module.default || module.auth || module.createAuth || null;

  if (!candidate) {
    throw new Error(`No auth export found in ${resolvedPath || configPath}`);
  }

  return typeof candidate === "function" ? candidate() : candidate;
}

function createLazyAuthContext(loadedConfig: { module: any; resolvedPath: string }, configPath: string | null, dryRun: boolean): any {
  let cachedAuth: any = null;

  return Object.defineProperty(
    {
      dryRun
    },
    "auth",
    {
      enumerable: true,
      get() {
        cachedAuth ||= loadAuthFromModule(loadedConfig, configPath);
        return cachedAuth;
      }
    }
  );
}

async function seedDemo(auth: any): Promise<any> {
  await auth.admin.bootstrapWorkspace({
    name: "Blindfold Demo Workspace",
    defaults: {
      mfa: { required: false }
    }
  });

  const application = await auth.admin.applications.create({
    slug: "billing-app",
    name: "Billing App",
    description: "Demo application seeded from the Blindfold CLI"
  });

  const principal = await auth.admin.principals.create({
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    password: "demo-password-123",
    attributes: {
      department: "finance",
      region: "eu"
    }
  });

  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "finance_admin",
    description: "Can read invoices and masked notes"
  });

  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "invoice",
    action: "read"
  });

  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  await auth.admin.policies.add({
    applicationId: application.id,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask",
    conditionJson: {
      neq: ["subject.department", "security"]
    }
  });

  return { application, principal, role };
}

async function seedLaunchDemo(auth: any): Promise<any> {
  await auth.admin.bootstrapWorkspace({
    name: "Blindfold Launch Demo Workspace",
    defaults: {
      mfa: { required: false }
    }
  });

  const snapshot = await auth.admin.exportSnapshot();

  function remember(table: string, value: any): any {
    snapshot[table] ||= [];
    snapshot[table].push(value);
    return value;
  }

  async function findOrCreateApplication({ slug, name, description, config }: any): Promise<any> {
    const existing = (snapshot.applications || []).find((application: any) => application.slug === slug);
    if (existing) {
      await auth.admin.applications.configure({
        applicationId: existing.id,
        config
      });
      return existing;
    }

    const created = await auth.admin.applications.create({
      slug,
      name,
      description,
      config
    });
    return remember("applications", created);
  }

  async function findOrCreatePrincipal({ email, displayName, password, attributes = {} }: any): Promise<any> {
    const existing = (snapshot.principals || []).find((principal: any) => principal.email === email);
    if (existing) {
      return existing;
    }

    return remember(
      "principals",
      await auth.admin.principals.create({
        email,
        displayName,
        password,
        attributes
      })
    );
  }

  async function findOrCreateRole({ applicationId, name, description }: any): Promise<any> {
    const existing = (snapshot.roles || []).find((role: any) => role.applicationId === applicationId && role.name === name);
    if (existing) {
      return existing;
    }

    return remember(
      "roles",
      await auth.admin.roles.create({
        applicationId,
        name,
        description
      })
    );
  }

  async function ensurePermission({ applicationId, roleId, resource, action, field = "*", effect = "allow" }: any): Promise<any> {
    const existing = (snapshot.role_permissions || []).find(
      (permission: any) =>
        permission.applicationId === applicationId &&
        permission.roleId === roleId &&
        permission.resource === resource &&
        permission.action === action &&
        permission.field === field &&
        permission.effect === effect
    );
    if (existing) {
      return existing;
    }

    return remember(
      "role_permissions",
      await auth.admin.roles.grantPermission({
        applicationId,
        roleId,
        resource,
        action,
        field,
        effect
      })
    );
  }

  async function ensureMembership({ principalId, applicationId, roleId, attributes = {} }: any): Promise<any> {
    const existing = (snapshot.memberships || []).find(
      (membership: any) =>
        membership.principalId === principalId &&
        membership.applicationId === applicationId &&
        membership.roleId === roleId
    );
    if (existing) {
      return existing;
    }

    return remember(
      "memberships",
      await auth.admin.memberships.assignRole({
        principalId,
        applicationId,
        roleId,
        attributes
      })
    );
  }

  async function ensurePolicy({ applicationId, resource, action, field = null, effect = "allow", conditionJson = null }: any): Promise<any> {
    const existing = (snapshot.policy_rules || []).find(
      (policy: any) =>
        policy.applicationId === applicationId &&
        policy.resource === resource &&
        policy.action === action &&
        policy.field === field &&
        policy.effect === effect
    );
    if (existing) {
      return existing;
    }

    return remember(
      "policy_rules",
      await auth.admin.policies.add({
        applicationId,
        resource,
        action,
        field,
        effect,
        conditionJson
      })
    );
  }

  async function findOrCreateIdentityProvider({ key, name, type, mode = "live", issuer, authorizationUrl, ssoUrl, clientId, claimMappings = {}, x509Certificate = null }: any): Promise<any> {
    const existing = (snapshot.identity_providers || []).find((provider: any) => provider.key === key);
    if (existing) {
      return existing;
    }

    return remember(
      "identity_providers",
      await auth.admin.identityProviders.create({
        key,
        name,
        type,
        mode,
        issuer,
        authorizationUrl,
        ssoUrl,
        clientId,
        claimMappings,
        x509Certificate
      })
    );
  }

  async function ensureApplicationProviderBinding({
    applicationId,
    providerId,
    domains = [],
    defaultRoleIds = [],
    claimMappings = {},
    enabled = true,
    allowIdpInitiated = false,
    authorizationUrl = null,
    ssoUrl = null,
    clientId = null,
    entityId = null
  }: any): Promise<any> {
    const existing = (snapshot.application_identity_providers || []).find(
      (binding: any) => binding.applicationId === applicationId && binding.providerId === providerId
    );
    if (existing) {
      return existing;
    }

    return remember(
      "application_identity_providers",
      await auth.admin.applicationProviders.bind({
        applicationId,
        providerId,
        domains,
        defaultRoleIds,
        claimMappings,
        enabled,
        allowIdpInitiated,
        authorizationUrl,
        ssoUrl,
        clientId,
        entityId
      })
    );
  }

  const localApplication = await findOrCreateApplication({
    slug: "launch-local-passkeys",
    name: "Launch Local Passkeys",
    description: "Passkey-first local app used for launch screenshots and browser demos",
    config: {
      authMethods: {
        password: true,
        magicLink: true,
        passkey: true,
        oidc: false,
        saml: false
      },
      security: {
        magicLinks: {
          returnTokenInResponse: true
        }
      },
      passkeys: {
        rpName: "Blindfold Launch Demo",
        origins: ["http://localhost:4400"]
      }
    }
  });

  const oidcApplication = await findOrCreateApplication({
    slug: "launch-enterprise-oidc",
    name: "Launch Enterprise OIDC",
    description: "OIDC enterprise demo app for launch flows",
    config: {
      authMethods: {
        oidc: true,
        password: false,
        magicLink: false,
        passkey: false,
        saml: false
      }
    }
  });

  const samlApplication = await findOrCreateApplication({
    slug: "launch-enterprise-saml",
    name: "Launch Enterprise SAML",
    description: "SAML enterprise demo app for launch flows",
    config: {
      authMethods: {
        saml: true,
        password: false,
        magicLink: false,
        passkey: false,
        oidc: false
      }
    }
  });

  const localFinanceRole = await findOrCreateRole({
    applicationId: localApplication.id,
    name: "finance_admin",
    description: "Reads invoices with masked internal notes"
  });
  const oidcRole = await findOrCreateRole({
    applicationId: oidcApplication.id,
    name: "enterprise_member",
    description: "Default role for OIDC JIT provisioning"
  });
  const samlRole = await findOrCreateRole({
    applicationId: samlApplication.id,
    name: "enterprise_member",
    description: "Default role for SAML JIT provisioning"
  });

  await ensurePermission({
    applicationId: localApplication.id,
    roleId: localFinanceRole.id,
    resource: "invoice",
    action: "read"
  });
  await ensurePermission({
    applicationId: oidcApplication.id,
    roleId: oidcRole.id,
    resource: "workspace",
    action: "read"
  });
  await ensurePermission({
    applicationId: samlApplication.id,
    roleId: samlRole.id,
    resource: "directory",
    action: "read"
  });

  await ensurePolicy({
    applicationId: localApplication.id,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask",
    conditionJson: {
      eq: ["subject.department", "finance"]
    }
  });

  const localPrincipal = await findOrCreatePrincipal({
    email: "ada@example.com",
    displayName: "Ada Lovelace",
    password: "demo-password-123",
    attributes: {
      department: "finance",
      region: "eu",
      launchPersona: "passkey"
    }
  });

  await ensureMembership({
    principalId: localPrincipal.id,
    applicationId: localApplication.id,
    roleId: localFinanceRole.id,
    attributes: { seededBy: "seed-launch-demo" }
  });

  const oktaProvider = await findOrCreateIdentityProvider({
    key: "okta-workforce",
    name: "Okta Workforce",
    type: "oidc",
    mode: "demo",
    issuer: "https://blindfold-demo.okta.example.com/oauth2/default",
    authorizationUrl: "https://blindfold-demo.okta.example.com/oauth2/v1/authorize",
    clientId: "okta-demo-client-id",
    claimMappings: {
      subject: "sub",
      email: "email",
      displayName: "name"
    }
  });

  const entraProvider = await findOrCreateIdentityProvider({
    key: "entra-workforce",
    name: "Microsoft Entra ID",
    type: "saml",
    mode: "demo",
    issuer: "https://sts.windows.net/demo-tenant/",
    ssoUrl: "https://login.microsoftonline.com/demo-tenant/saml2",
    claimMappings: {
      subject: "sub",
      email: "email",
      displayName: "name"
    },
    x509Certificate: "MIICdzCCAhCgAwIBAgIBADANBgkqhkiG9w0BAQsFADBvMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExFDASBgNVBAcMC0xvcyBBbmdlbGVzMRcwFQYDVQQKDA5CbGluZGZvbGQgRGVtbzEYMBYGA1UEAwwPQmxpbmRmb2xkIFNhbWwwHhcNMjYwMTAxMDAwMDAwWhcNMzYwMTAxMDAwMDAwWjBvMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExFDASBgNVBAcMC0xvcyBBbmdlbGVzMRcwFQYDVQQKDA5CbGluZGZvbGQgRGVtbzEYMBYGA1UEAwwPQmxpbmRmb2xkIFNhbWwwgZ8wDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBALWmSkdeterministicdemoq7xY4mM8aq6xLq3o8w4k3k9u1P1S4L5f8E9l6R3C1n7oHc3JvQv3jM9Qm0r2E1p7Qm5v5V7f9b2w8dX8s8Z5L9c4q5r3Z2T6p4m1p2q5w8n3s6t1r4w7y2u6i9o3p5a7s9d1f3g5h7j9k1m3n5p7q9rAgMBAAEwDQYJKoZIhvcNAQELBQADgYEAhwX0demoXxW6t8q3b9m4c1w7u2x5p8n4a1s6d9f2g5h8j1k4l7m0n3p6q9r2t5v8y1z4a7c0e3g6i9k2m5o8q1s4u7w0y3"
  });

  const oidcBinding = await ensureApplicationProviderBinding({
    applicationId: oidcApplication.id,
    providerId: oktaProvider.id,
    domains: ["okta.example.com"],
    defaultRoleIds: [oidcRole.id],
    claimMappings: {
      email: "email",
      displayName: "name"
    },
    clientId: "okta-demo-client-id"
  });

  const samlBinding = await ensureApplicationProviderBinding({
    applicationId: samlApplication.id,
    providerId: entraProvider.id,
    domains: ["entra.example.com"],
    defaultRoleIds: [samlRole.id],
    claimMappings: {
      email: "email",
      displayName: "name"
    },
    allowIdpInitiated: true,
    entityId: "blindfold-launch-saml-sp"
  });

  return {
    applications: {
      local: localApplication,
      oidc: oidcApplication,
      saml: samlApplication
    },
    principals: {
      local: localPrincipal
    },
    providers: {
      oidc: oktaProvider,
      saml: entraProvider
    },
    bindings: {
      oidc: oidcBinding,
      saml: samlBinding
    }
  };
}

export async function runCli(argv: string[] = process.argv.slice(2), io: Io = console): Promise<any> {
  const [command] = argv;
  if (!command || command === "help" || argv.includes("--help") || argv.includes("-h")) {
    io.log(helpText());
    return;
  }

  // M6 commands are self-contained (no blindfold.config.js required).
  const m6Command = M6_COMMANDS[command];
  if (m6Command) {
    return m6Command(argv, io);
  }

  const configPath = readFlag(argv, "--config", "./blindfold.config.js");
  const loadedConfig = await loadConfigModule(configPath);

  if (command === "migrate") {
    const dryRun = argv.includes("--dry-run");
    const migrateHook = loadedConfig.module.migrate;

    if (typeof migrateHook === "function") {
      const result = await migrateHook(createLazyAuthContext(loadedConfig, configPath, dryRun));
      io.log(`Migration ${dryRun ? "plan" : "completed"} using config ${loadedConfig.resolvedPath}`);
      if (result?.plan?.length) {
        io.log(`Migrations: ${result.plan.map((entry: any) => entry.id).join(", ")}`);
      }
      return;
    }

    const auth = loadAuthFromModule(loadedConfig, configPath);
    if (typeof auth?.storage?.ensureTables === "function") {
      if (dryRun) {
        io.log(`No named migrate() export found in ${loadedConfig.resolvedPath}.`);
        io.log("Dry run is only supported when the config module exports migrate({ auth, dryRun }).");
        return;
      }

      await auth.storage.ensureTables();
      io.log(`Migration completed for storage kind ${auth.storage.kind || "unknown"} using ${loadedConfig.resolvedPath}`);
      return;
    }

    throw new Error(`No migrate() export or storage.ensureTables() implementation found in ${loadedConfig.resolvedPath}`);
  }

  const auth = loadAuthFromModule(loadedConfig, configPath);

  if (command === "studio") {
    const port = Number(readFlag(argv, "--port", "4110"));
    const host = readFlag(argv, "--host", "127.0.0.1");
    const { url } = await startStudio({ auth, port, host });
    io.log(`Blindfold Studio running at ${url}`);
    return;
  }

  if (command === "bootstrap") {
    const workspaceName = readFlag(argv, "--workspace-name", "Blindfold Workspace");
    const workspace = await auth.admin.bootstrapWorkspace({ name: workspaceName });
    io.log(`Bootstrapped workspace ${workspace.name} (${workspace.id})`);
    return;
  }

  if (command === "seed-demo") {
    const result = await seedDemo(auth);
    io.log(`Seeded demo app ${result.application.name} with principal ${result.principal.email}`);
    return;
  }

  if (command === "seed-launch-demo") {
    const result = await seedLaunchDemo(auth);
    io.log(`Seeded launch demo apps: ${Object.values(result.applications).map((application: any) => application.slug).join(", ")}`);
    io.log(`Seeded shared providers: ${Object.values(result.providers).map((provider: any) => provider.key).join(", ")}`);
    return;
  }

  io.log(helpText());
}

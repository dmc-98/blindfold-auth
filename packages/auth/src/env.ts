export const BLINDFOLD_ENV_NAMES = {
  workspaceId: "BLINDFOLD_WORKSPACE_ID",
  secret: "BLINDFOLD_SECRET",
  databaseUrl: "BLINDFOLD_DATABASE_URL",
  postgresSchema: "BLINDFOLD_POSTGRES_SCHEMA",
  studioHost: "BLINDFOLD_STUDIO_HOST",
  studioPort: "BLINDFOLD_STUDIO_PORT"
} as const;

export interface BlindfoldEnvConfig {
  workspaceId: string;
  secret: string | null;
  postgres: { url: string | null; schema: string };
  studio: { host: string; port: number };
}

export interface LoadEnvOptions {
  env?: NodeJS.ProcessEnv;
  defaults?: Partial<{
    workspaceId: string;
    secret: string;
    postgres: Partial<{ url: string; schema: string }>;
    studio: Partial<{ host: string; port: number }>;
  }>;
}

export function loadBlindfoldEnv({ env = process.env, defaults = {} }: LoadEnvOptions = {}): BlindfoldEnvConfig {
  const studioPortValue = env[BLINDFOLD_ENV_NAMES.studioPort] ?? defaults.studio?.port ?? 4110;
  const studioPort = Number(studioPortValue);

  return {
    workspaceId: env[BLINDFOLD_ENV_NAMES.workspaceId] ?? defaults.workspaceId ?? "workspace_local",
    secret: env[BLINDFOLD_ENV_NAMES.secret] ?? defaults.secret ?? null,
    postgres: {
      url: env[BLINDFOLD_ENV_NAMES.databaseUrl] ?? defaults.postgres?.url ?? null,
      schema: env[BLINDFOLD_ENV_NAMES.postgresSchema] ?? defaults.postgres?.schema ?? "blindfold"
    },
    studio: {
      host: env[BLINDFOLD_ENV_NAMES.studioHost] ?? defaults.studio?.host ?? "127.0.0.1",
      port: Number.isFinite(studioPort) ? studioPort : 4110
    }
  };
}

export function assertBlindfoldEnv(
  config: BlindfoldEnvConfig,
  { requireDatabaseUrl = false }: { requireDatabaseUrl?: boolean } = {}
): BlindfoldEnvConfig {
  if (!config?.secret) {
    throw new Error(`Missing required env var ${BLINDFOLD_ENV_NAMES.secret}`);
  }

  if (requireDatabaseUrl && !config?.postgres?.url) {
    throw new Error(`Missing required env var ${BLINDFOLD_ENV_NAMES.databaseUrl}`);
  }

  return config;
}

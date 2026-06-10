import { createAuth, createMemoryStorage } from "@blindfold/auth";

const auth = createAuth({
  workspaceId: "workspace_cli_fixture",
  secret: "fixture-secret",
  storage: createMemoryStorage()
});

export async function migrate({ dryRun }: { dryRun?: boolean }) {
  return {
    dryRun,
    plan: [
      {
        id: "0001_core_tables"
      }
    ]
  };
}

export default auth;

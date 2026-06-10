import { createAuth, createMemoryStorage } from "@blindfold/auth";

export default createAuth({
  workspaceId: "workspace_cli_ensure_tables",
  secret: "fixture-secret",
  storage: createMemoryStorage()
});

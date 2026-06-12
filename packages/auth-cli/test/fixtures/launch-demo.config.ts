import { createAuth, createMemoryStorage } from "@dmc--98/blindfold-auth";

export default function createLaunchDemoAuth() {
  return createAuth({
    workspaceId: "workspace_cli_launch_demo",
    secret: "launch-demo-secret",
    storage: createMemoryStorage()
  });
}

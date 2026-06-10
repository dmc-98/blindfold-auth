import { createAuth, createMemoryStorage } from "@blindfold/auth";

export default function createLaunchDemoAuth() {
  return createAuth({
    workspaceId: "workspace_cli_launch_demo",
    secret: "launch-demo-secret",
    storage: createMemoryStorage()
  });
}

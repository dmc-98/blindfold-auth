import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth, createFileStorage, loadBlindfoldEnv } from "@dmc--98/blindfold-auth";

const directory = dirname(fileURLToPath(import.meta.url));
const filePath = join(directory, ".blindfold", "workspace.json");
const env = loadBlindfoldEnv({
  defaults: {
    workspaceId: "workspace_local_demo",
    secret: "blindfold-dev-secret"
  }
});

const auth = createAuth({
  workspaceId: env.workspaceId,
  secret: env.secret!,
  storage: createFileStorage({ filePath })
});

export default auth;

import { runStorageConformance } from "@dmc--98/blindfold-testing/conformance";
import { createSqliteStorage } from "../src/index.js";

// Fresh in-memory database per adapter instance so each conformance test is isolated.
runStorageConformance({
  name: "sqlite",
  createStorage: () => createSqliteStorage({ filePath: ":memory:" })
});

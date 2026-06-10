import { runStorageConformance } from "@blindfold/testing/conformance";
import { createMongoStorage } from "../src/index.js";
import { createInMemoryMongoDb } from "../src/in-memory-db.js";

// Fresh in-memory Mongo-compatible db per adapter instance.
runStorageConformance({
  name: "mongo",
  createStorage: () => createMongoStorage({ db: createInMemoryMongoDb() })
});

#!/usr/bin/env node
import { runCli } from "../src/index.js";

runCli()
  .then((code) => {
    // Commands return numeric exit codes; long-running commands (playground,
    // studio) return handles — leave those running with the default code.
    if (typeof code === "number") process.exitCode = code;
  })
  .catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });

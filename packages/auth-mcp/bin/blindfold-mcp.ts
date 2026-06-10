#!/usr/bin/env node
import { createMcpServer } from "../src/index.js";
import { createControlPlane, createFileStore } from "@blindfold/control";

/**
 * stdio entry for the Blindfold MCP server. Persists the control plane to a
 * local file so projects/keys survive restarts. Requires the optional
 * @modelcontextprotocol/sdk dependency at runtime.
 */
const storePath = process.env.BLINDFOLD_CONTROL_FILE || "./blindfold.control.json";
const controlPlane = createControlPlane({ store: createFileStore(storePath) });

try {
  const { server } = await createMcpServer({ controlPlane });
  const stdioSpecifier = "@modelcontextprotocol/sdk/server/stdio.js";
  const { StdioServerTransport } = await import(stdioSpecifier);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(`[blindfold-mcp] ${(error as Error).message}`);
  process.exit(1);
}

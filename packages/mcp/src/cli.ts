#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

import { createT2kMcpRuntime, T2K_MCP_VERSION } from "./server.js";

const help = `t2k-mcp ${T2K_MCP_VERSION}

Safe local MCP adapter for the open T2K runtime.

Usage:
  t2k-mcp
  t2k-mcp --help
  t2k-mcp --version

Environment:
  T2K_DATABASE_URL            Enable local lifecycle read tools.
  T2K_MCP_AUTO_MIGRATE=true  Apply the idempotent reference schema at startup.
  T2K_MCP_ALLOW_MUTATIONS=true
                              Enable agent mutation tools.
  T2K_MCP_ACTOR_ID=<id>       Fixed agent identity required for mutations.

Human approval, authorization, closure, evaluation, promotion, deployment, and
rollback operations are deliberately never exposed by this MCP server.
`;

function enabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`${T2K_MCP_VERSION}\n`);
  process.exit(0);
}

if (process.argv.length > 2) {
  process.stderr.write("t2k-mcp received an unsupported argument. Use --help.\n");
  process.exit(2);
}

try {
  const runtime = await createT2kMcpRuntime({
    connectionString: process.env.T2K_DATABASE_URL,
    autoMigrate: enabled(process.env.T2K_MCP_AUTO_MIGRATE),
    allowMutations: enabled(process.env.T2K_MCP_ALLOW_MUTATIONS),
    actorId: process.env.T2K_MCP_ACTOR_ID,
    logger(message, error) {
      const detail = error instanceof Error ? ` ${error.stack ?? error.message}` : "";
      process.stderr.write(`${message}${detail}\n`);
    },
  });
  const transport = new StdioServerTransport();

  const shutdown = () => {
    void runtime.close().then(
      () => process.exit(0),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error.";
        process.stderr.write(`t2k-mcp shutdown failed: ${message}\n`);
        process.exit(1);
      }
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await runtime.server.connect(transport);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  process.stderr.write(`t2k-mcp failed to start: ${message}\n`);
  process.exit(1);
}

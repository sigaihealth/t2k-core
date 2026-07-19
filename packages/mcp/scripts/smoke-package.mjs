import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t2k-mcp-package-"));

const smokeProgram = String.raw`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const binary = process.argv[1];
const client = new Client({ name: "t2k-mcp-package-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({ command: binary, stderr: "pipe" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  if (
    !names.includes("evaluate_reference_policy") ||
    names.includes("authorize_recommendation") ||
    names.includes("promote_learning_candidate")
  ) {
    throw new Error("Packed MCP server advertised an unsafe or incomplete tool set.");
  }

  const result = await client.callTool({
    name: "evaluate_reference_policy",
    arguments: {
      specification: {
        referencePolicy: {
          rules: [],
          defaultAction: "hold",
          evaluation: {
            minimumEpisodes: 20,
            minimumImprovement: 0.05,
            confidenceZ: 1.96,
            minimumCoverage: 0.2
          }
        }
      },
      state: {}
    }
  });
  if (result.structuredContent?.result !== "hold") {
    throw new Error("Packed MCP server did not execute the reference policy.");
  }
} finally {
  await client.close();
}
`;

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "@t2kai/mcp",
        "--pack-destination",
        smokeRoot,
        "--silent",
        "--json",
      ],
      { cwd: workspaceRoot, encoding: "utf8" }
    )
  );
  const tarball = path.join(smokeRoot, packResult[0].filename);
  await fs.writeFile(
    path.join(smokeRoot, "package.json"),
    `${JSON.stringify({ name: "t2k-mcp-smoke", private: true, type: "module" })}\n`,
    "utf8"
  );
  execFileSync(
    "npm",
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: smokeRoot, stdio: "inherit" }
  );

  const binary = path.join(
    smokeRoot,
    "node_modules/.bin",
    process.platform === "win32" ? "t2k-mcp.cmd" : "t2k-mcp"
  );
  const help = execFileSync(binary, ["--help"], {
    cwd: smokeRoot,
    encoding: "utf8",
  });
  if (!help.includes("Human approval")) {
    throw new Error("Packed MCP CLI did not document its governance boundary.");
  }
  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", smokeProgram, binary],
    { cwd: smokeRoot, stdio: "inherit" }
  );
  console.log("Packed @t2kai/mcp stdio smoke test passed.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

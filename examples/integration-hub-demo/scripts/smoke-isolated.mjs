import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const demoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repositoryRoot = path.resolve(demoRoot, "../..");
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "t2k-integration-hub-smoke-")
);

try {
  await fs.access(path.join(repositoryRoot, "packages/core/dist/index.js"));
  await execFileAsync(
    "npm",
    [
      "pack",
      "--ignore-scripts",
      "./packages/core",
      "--pack-destination",
      temporaryRoot,
    ],
    { cwd: repositoryRoot }
  );
  const archiveName = (await fs.readdir(temporaryRoot)).find((name) =>
    name.endsWith(".tgz")
  );
  assert.ok(archiveName, "The @t2kai/core package archive was not produced.");

  const consumerRoot = path.join(temporaryRoot, "consumer");
  await fs.mkdir(consumerRoot);
  for (const entry of [
    "authority-policy.json",
    "ontology-pack.json",
    "purpose-access-policy.json",
    "source-records",
    "src",
  ]) {
    await fs.cp(path.join(demoRoot, entry), path.join(consumerRoot, entry), {
      recursive: true,
    });
  }
  await fs.writeFile(
    path.join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "t2k-integration-hub-isolated-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@t2kai/core": `file:${path.join(temporaryRoot, archiveName)}`,
        },
      },
      null,
      2
    )}\n`
  );
  await execFileAsync("npm", ["install", "--ignore-scripts"], {
    cwd: consumerRoot,
  });
  const { stdout } = await execFileAsync(
    "node",
    [
      "--input-type=module",
      "--eval",
      "const { buildDemoModel } = await import('./src/demo-model.mjs'); const model = await buildDemoModel(); console.log(JSON.stringify({ sources: model.metrics.sourceCount, status: model.proposal.status, deterministic: model.determinism.verified, entity: model.entityResolution.decision.status, access: model.purposeAccess.checks.map(({ receipt }) => receipt.reasonCode) }));",
    ],
    { cwd: consumerRoot }
  );
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result, {
    sources: 3,
    status: "needs_review",
    deterministic: true,
    entity: "needs_review",
    access: ["explicit_allow", "default_deny"],
  });
  console.log("Isolated package smoke passed:", JSON.stringify(result));
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

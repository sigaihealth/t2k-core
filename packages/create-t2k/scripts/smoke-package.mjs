import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { exerciseIntegrationHubExperiments } from "./integration-hub-smoke-helpers.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-package-"));

function packWorkspace(workspace) {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        workspace,
        "--pack-destination",
        smokeRoot,
        "--silent",
        "--json",
      ],
      { cwd: workspaceRoot, encoding: "utf8" }
    )
  );
  return path.join(smokeRoot, packResult[0].filename);
}

try {
  const coreManifest = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, "packages/core/package.json"), "utf8")
  );
  const expectedCoreDependency = `^${coreManifest.version}`;
  const coreTarball = packWorkspace("@t2kai/core");
  const tarball = packWorkspace("create-t2k");
  await fs.writeFile(
    path.join(smokeRoot, "package.json"),
    `${JSON.stringify({ name: "create-t2k-smoke", private: true })}\n`,
    "utf8"
  );
  execFileSync(
    "npm",
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: smokeRoot, stdio: "inherit" }
  );

  const generatedPath = path.join(smokeRoot, "generated-project");
  const binary = path.join(
    smokeRoot,
    "node_modules/.bin",
    process.platform === "win32" ? "create-t2k.cmd" : "create-t2k"
  );
  const help = execFileSync(binary, ["--help"], {
    cwd: smokeRoot,
    encoding: "utf8",
  });
  if (!help.includes("--profile <name>") || !help.includes("integration-hub")) {
    throw new Error("Packed create-t2k help did not advertise the profile contract.");
  }
  execFileSync(binary, [generatedPath, "--no-install"], {
    cwd: smokeRoot,
    stdio: "inherit",
  });
  const generatedManifest = JSON.parse(
    await fs.readFile(path.join(generatedPath, "package.json"), "utf8")
  );
  if (
    generatedManifest.name !== "generated-project" ||
    generatedManifest.dependencies?.["@t2kai/core"] !== expectedCoreDependency ||
    generatedManifest.scripts?.["db:down"] !== "docker compose down" ||
    generatedManifest.scripts?.["db:reset"] !== "docker compose down -v"
  ) {
    throw new Error("Packed create-t2k did not generate the expected project.");
  }
  await Promise.all([
    fs.access(path.join(generatedPath, "compose.yml")),
    fs.access(path.join(generatedPath, "src/lifecycle.mjs")),
  ]);

  const integrationPath = path.join(smokeRoot, "generated-integration-hub");
  execFileSync(
    binary,
    [integrationPath, "--profile=integration-hub", "--no-install"],
    { cwd: smokeRoot, stdio: "inherit" }
  );
  const integrationManifest = JSON.parse(
    await fs.readFile(path.join(integrationPath, "package.json"), "utf8")
  );
  if (
    integrationManifest.name !== "generated-integration-hub" ||
    integrationManifest.dependencies?.["@t2kai/core"] !== expectedCoreDependency ||
    integrationManifest.scripts?.start !== "node src/run.mjs"
  ) {
    throw new Error("Packed create-t2k did not generate the integration-hub profile.");
  }
  await Promise.all([
    fs.access(path.join(integrationPath, "authority-policy.json")),
    fs.access(path.join(integrationPath, "ontology-pack.json")),
    fs.access(path.join(integrationPath, "source-records/registry-alpha.json")),
    fs.access(path.join(integrationPath, "source-records/registry-beta.json")),
    fs.access(path.join(integrationPath, "src/run.mjs")),
  ]);
  integrationManifest.dependencies["@t2kai/core"] = `file:${coreTarball}`;
  await fs.writeFile(
    path.join(integrationPath, "package.json"),
    `${JSON.stringify(integrationManifest, null, 2)}\n`,
    "utf8"
  );
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: integrationPath,
    stdio: "inherit",
  });
  const installedCoreManifest = JSON.parse(
    await fs.readFile(
      path.join(integrationPath, "node_modules/@t2kai/core/package.json"),
      "utf8"
    )
  );
  const integrationLock = JSON.parse(
    await fs.readFile(path.join(integrationPath, "package-lock.json"), "utf8")
  );
  const lockedCore = integrationLock.packages?.["node_modules/@t2kai/core"];
  if (
    installedCoreManifest.version !== coreManifest.version ||
    lockedCore?.version !== coreManifest.version ||
    !lockedCore.resolved?.endsWith(path.basename(coreTarball))
  ) {
    throw new Error("Generated integration-hub did not install the packed local core.");
  }
  await exerciseIntegrationHubExperiments(integrationPath);
  console.log("Packed create-t2k profile smoke tests passed.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

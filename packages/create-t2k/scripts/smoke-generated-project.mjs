import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldProject } from "../src/scaffold.mjs";
import { exerciseIntegrationHubExperiments } from "./integration-hub-smoke-helpers.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const coreRoot = path.join(workspaceRoot, "packages/core");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-smoke-"));
const coreManifest = JSON.parse(await fs.readFile(path.join(coreRoot, "package.json"), "utf8"));

async function installGeneratedProject({
  targetDirectory,
  profile,
  coreTarball,
}) {
  const project = await scaffoldProject({
    targetDirectory,
    profile,
    install: false,
    cwd: smokeRoot,
    stdout: { write() {} },
  });
  const manifestPath = path.join(project.targetPath, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.dependencies?.["@t2kai/core"] !== coreManifest.version) {
    throw new Error(`Generated ${profile} does not pin this release's exact Core version.`);
  }
  manifest.dependencies["@t2kai/core"] = `file:${coreTarball}`;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: project.targetPath,
    stdio: "inherit",
  });
  const installedCore = JSON.parse(await fs.readFile(
    path.join(project.targetPath, "node_modules/@t2kai/core/package.json"), "utf8",
  ));
  const installedLock = JSON.parse(await fs.readFile(
    path.join(project.targetPath, "package-lock.json"), "utf8",
  ));
  const lockedCore = installedLock.packages?.["node_modules/@t2kai/core"];
  if (installedCore.version !== coreManifest.version ||
      lockedCore?.version !== coreManifest.version ||
      !lockedCore.resolved?.endsWith(path.basename(coreTarball))) {
    throw new Error(`Generated ${profile} did not install the packed Core release.`);
  }
  const output = execFileSync("npm", ["run", "check"], {
    cwd: project.targetPath,
    encoding: "utf8",
  });
  if (profile === "decision-loop") {
    if (!output.includes('"status": "passed"')) {
      throw new Error("Generated project did not produce a passing computed replay.");
    }
  } else {
    await exerciseIntegrationHubExperiments(project.targetPath);
  }
  if (profile === "decision-loop" && process.env.T2K_TEST_DATABASE_URL) {
    const lifecycleOutput = execFileSync("npm", ["run", "lifecycle"], {
      cwd: project.targetPath,
      encoding: "utf8",
    });
    if (
      !lifecycleOutput.includes('"exactParentRestored": true') ||
      !lifecycleOutput.includes('"executionReceipts": 24')
    ) {
      throw new Error("Generated project did not complete its persisted lifecycle.");
    }
  }
}

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", coreRoot, "--pack-destination", smokeRoot, "--silent", "--json"],
      { cwd: workspaceRoot, encoding: "utf8" }
    )
  );
  const coreTarball = path.join(smokeRoot, packResult[0].filename);
  await installGeneratedProject({
    targetDirectory: "harborlight-quickstart",
    profile: "decision-loop",
    coreTarball,
  });
  await installGeneratedProject({
    targetDirectory: "integration-hub-quickstart",
    profile: "integration-hub",
    coreTarball,
  });
  console.log("Generated create-t2k profiles installed and ran successfully.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

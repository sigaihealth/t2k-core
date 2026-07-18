import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldProject } from "../src/scaffold.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const coreRoot = path.join(workspaceRoot, "packages/core");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-smoke-"));

try {
  const project = await scaffoldProject({
    targetDirectory: "harborlight-quickstart",
    install: false,
    cwd: smokeRoot,
    stdout: { write() {} },
  });
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", coreRoot, "--pack-destination", smokeRoot, "--silent", "--json"],
      { cwd: workspaceRoot, encoding: "utf8" }
    )
  );
  const manifestPath = path.join(project.targetPath, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.dependencies["@t2kai/core"] = `file:${path.join(
    smokeRoot,
    packResult[0].filename
  )}`;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: project.targetPath,
    stdio: "inherit",
  });
  const output = execFileSync("npm", ["run", "check"], {
    cwd: project.targetPath,
    encoding: "utf8",
  });
  if (!output.includes('"status": "passed"')) {
    throw new Error("Generated project did not produce a passing computed replay.");
  }
  console.log("Generated create-t2k project installed and ran successfully.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

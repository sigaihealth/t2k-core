import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-package-"));

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "create-t2k",
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
  execFileSync(binary, [generatedPath, "--no-install"], {
    cwd: smokeRoot,
    stdio: "inherit",
  });
  const generatedManifest = JSON.parse(
    await fs.readFile(path.join(generatedPath, "package.json"), "utf8")
  );
  if (
    generatedManifest.name !== "generated-project" ||
    generatedManifest.dependencies?.["@t2kai/core"] !== "^0.1.0"
  ) {
    throw new Error("Packed create-t2k did not generate the expected project.");
  }
  console.log("Packed create-t2k binary smoke test passed.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

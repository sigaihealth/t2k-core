import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { verifyReleaseTag } from "../../../scripts/verify-release-tag.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
);

try {
  console.log(
    verifyReleaseTag({
      actualTag: process.env.GITHUB_REF_NAME || process.argv[2],
      expectedTag: `core-v${manifest.version}`,
      mainRef:
        process.env.T2K_RELEASE_MAIN_REF || process.argv[3] || "origin/main",
      packageLabel: `@t2kai/core ${manifest.version}`,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

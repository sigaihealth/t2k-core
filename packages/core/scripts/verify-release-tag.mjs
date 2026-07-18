import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8")
);
const expectedTag = `core-v${manifest.version}`;
const actualTag = process.env.GITHUB_REF_NAME || process.argv[2];

if (actualTag !== expectedTag) {
  console.error(`Release tag ${actualTag || "<missing>"} must equal ${expectedTag}.`);
  process.exit(1);
}

console.log(`Release tag ${actualTag} matches @t2k/core ${manifest.version}.`);

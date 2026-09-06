import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const releasePrefixes = new Map([
  ["@t2kai/core", "core-v"],
  ["@t2kai/mcp", "mcp-v"],
  ["create-t2k", "create-t2k-v"],
]);

/** Reject ambiguous versions and mismatched tags before choosing any npm channel. */
export function selectReleaseChannel({ packageName, version, tag }) {
  const prefix = releasePrefixes.get(packageName);
  if (!prefix) throw new Error("Unknown publishable T2K package.");
  const match = typeof version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match || version.length > 256 ||
      match.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part))) ||
      match[4]?.split(".").some((part) => /^0\d+$/.test(part))) {
    throw new Error("Release version must be canonical SemVer without build metadata.");
  }
  if (tag !== `${prefix}${version}`) {
    throw new Error(`Release tag must exactly match ${prefix}${version}.`);
  }
  return match[4] ? "next" : "latest";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/release-channel.mjs package.json");
    const manifest = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
    console.log(selectReleaseChannel({
      packageName: manifest.name,
      version: manifest.version,
      tag: process.env.GITHUB_REF_NAME,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

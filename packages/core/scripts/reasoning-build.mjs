import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const format = "t2k.reasoning-build.v1";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});
const backupPath = (root) => path.join(root, "tmp", "reasoning-build-package-backup.json");

/** Match Studio's executable inventory: every dist JavaScript/JSON byte and its package contract. */
export function reasoningBuildManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const root = path.dirname(manifestPath);
  const files = {};
  function visit(directory) {
    if (lstatSync(directory).isSymbolicLink()) throw new Error("Executable symlinks are unsupported.");
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Executable symlinks are unsupported.");
      if (entry.isDirectory()) visit(location);
      else if (/\.(js|json)$/.test(entry.name)) files[path.relative(root, location).split(path.sep).join("/")] = digest(readFileSync(location));
    }
  }
  visit(path.join(root, "dist"));
  if (!Object.keys(files).length) throw new Error("A reasoning build must contain executable files.");
  return { format, buildHash: digest(canonical({ files, exports: manifest.exports, dependencies: manifest.dependencies ?? {} })), files };
}

export function verifyReasoningBuild(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actual = reasoningBuildManifest(manifestPath);
  const stamp = manifest.t2kReasoningBuild;
  if (stamp?.format !== format || stamp.buildHash !== actual.buildHash || canonical(stamp.files) !== canonical(actual.files)) {
    throw new Error("Installed reasoning executable does not match its build manifest.");
  }
  return { version: String(manifest.version), buildHash: actual.buildHash };
}

/** Stamp only while npm packs; an exclusive journal preserves the exact source manifest. */
export function prepareReasoningBuild(root = packageRoot) {
  const manifestPath = path.join(root, "package.json");
  const journalPath = backupPath(root);
  if (existsSync(journalPath)) throw new Error("A reasoning pack is already prepared. Finish it or run reasoning-build.mjs restore before packing again.");
  const original = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(original);
  manifest.t2kReasoningBuild = reasoningBuildManifest(manifestPath);
  const stamped = JSON.stringify(manifest, null, 2) + "\n";
  mkdirSync(path.dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, JSON.stringify({ original, stampedHash: digest(stamped) }), { flag: "wx", mode: 0o600 });
  writeFileSync(manifestPath, stamped);
  return verifyReasoningBuild(manifestPath);
}

/** Never overwrite concurrent developer edits when restoring after npm pack. */
export function restoreReasoningBuild(root = packageRoot) {
  const manifestPath = path.join(root, "package.json");
  const journalPath = backupPath(root);
  if (!existsSync(journalPath)) throw new Error("No prepared reasoning pack is available to restore.");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (typeof journal.original !== "string" || !/^[a-f0-9]{64}$/.test(journal.stampedHash)) throw new Error("The reasoning pack recovery journal is invalid.");
  const current = readFileSync(manifestPath, "utf8");
  if (digest(current) !== journal.stampedHash && current !== journal.original) {
    throw new Error("package.json changed while packing. Preserve those changes and recover the original from the reasoning pack journal before retrying.");
  }
  writeFileSync(manifestPath, journal.original);
  unlinkSync(journalPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Lifecycle hooks must keep stdout clean for npm pack --json consumers.
    if (process.argv[2] === "prepare") prepareReasoningBuild();
    else if (process.argv[2] === "restore") restoreReasoningBuild();
    else if (process.argv[2] === "verify") console.log(JSON.stringify(verifyReasoningBuild(path.resolve(process.argv[3] ?? path.join(packageRoot, "package.json")))));
    else throw new Error("Usage: node scripts/reasoning-build.mjs prepare|restore|verify [installed-package.json]");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

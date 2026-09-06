import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Build scripts are JavaScript and intentionally are not part of the public TypeScript API.
// @ts-expect-error no declaration is emitted for the release script
import { prepareReasoningBuild, reasoningBuildManifest, restoreReasoningBuild, verifyReasoningBuild } from "../../scripts/reasoning-build.mjs";

const roots: string[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "t2k-reasoning-build-"));
  roots.push(root);
  mkdirSync(path.join(root, "dist", "schema"), { recursive: true });
  writeFileSync(path.join(root, "dist", "reasoning.js"), "export const runtime = 'v1';\n");
  writeFileSync(path.join(root, "dist", "schema", "example.json"), '{"type":"object"}\n');
  writeFileSync(path.join(root, "dist", "reasoning.d.ts"), "export declare const runtime: string;\n");
  const manifestPath = path.join(root, "package.json");
  writeFileSync(manifestPath, JSON.stringify({
    name: "@t2kai/core", version: "0.5.0-rc.1", exports: { "./reasoning": "./dist/reasoning.js" },
    dependencies: { z: "^1", a: "^2" },
  }, null, 4) + "\n");
  return { root, manifestPath };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("published reasoning build manifest", () => {
  it("matches the canonical Studio contract and restores the source manifest byte for byte", () => {
    const { root, manifestPath } = fixture();
    const original = readFileSync(manifestPath, "utf8");
    const files = {
      "dist/reasoning.js": hash("export const runtime = 'v1';\n"),
      "dist/schema/example.json": hash('{"type":"object"}\n'),
    };
    const expectedHash = hash(JSON.stringify({ dependencies: { a: "^2", z: "^1" }, exports: { "./reasoning": "./dist/reasoning.js" }, files }));
    expect(prepareReasoningBuild(root)).toEqual({ version: "0.5.0-rc.1", buildHash: expectedHash });
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).t2kReasoningBuild).toEqual({ format: "t2k.reasoning-build.v1", buildHash: expectedHash, files });
    expect(verifyReasoningBuild(manifestPath).buildHash).toBe(expectedHash);
    const first = readFileSync(manifestPath, "utf8");
    restoreReasoningBuild(root);
    expect(readFileSync(manifestPath, "utf8")).toBe(original);
    prepareReasoningBuild(root);
    expect(readFileSync(manifestPath, "utf8")).toBe(first);
    restoreReasoningBuild(root);
  });

  it.each(["changed", "added", "removed", "schema"])("rejects %s executable inventory bytes", (mutation) => {
    const { root, manifestPath } = fixture();
    prepareReasoningBuild(root);
    if (mutation === "changed") writeFileSync(path.join(root, "dist/reasoning.js"), "export const runtime = 'tampered';");
    if (mutation === "added") writeFileSync(path.join(root, "dist/extra.js"), "export const extra = true;");
    if (mutation === "removed") rmSync(path.join(root, "dist/reasoning.js"));
    if (mutation === "schema") writeFileSync(path.join(root, "dist/schema/example.json"), "{}");
    expect(() => verifyReasoningBuild(manifestPath)).toThrow("does not match its build manifest");
  });

  it.each(["exports", "dependencies", "buildHash", "files", "format", "missing"])("rejects tampered %s in the packed manifest", (mutation) => {
    const { root, manifestPath } = fixture();
    prepareReasoningBuild(root);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (mutation === "exports") manifest.exports["./reasoning"] = "./dist/elsewhere.js";
    if (mutation === "dependencies") manifest.dependencies.a = "^3";
    if (mutation === "buildHash") manifest.t2kReasoningBuild.buildHash = "0".repeat(64);
    if (mutation === "files") delete manifest.t2kReasoningBuild.files["dist/reasoning.js"];
    if (mutation === "format") manifest.t2kReasoningBuild.format = "invalid";
    if (mutation === "missing") delete manifest.t2kReasoningBuild;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyReasoningBuild(manifestPath)).toThrow("does not match its build manifest");
  });

  it("fails closed on empty builds and executable symlinks", () => {
    const { root, manifestPath } = fixture();
    symlinkSync(path.join(root, "package.json"), path.join(root, "dist", "linked.json"));
    expect(() => reasoningBuildManifest(manifestPath)).toThrow("symlinks are unsupported");
    rmSync(path.join(root, "dist"), { recursive: true });
    mkdirSync(path.join(root, "dist"));
    expect(() => reasoningBuildManifest(manifestPath)).toThrow("must contain executable files");
  });

  it("refuses concurrent packs and recovers an interrupted pack explicitly", () => {
    const { root, manifestPath } = fixture();
    const original = readFileSync(manifestPath, "utf8");
    prepareReasoningBuild(root);
    expect(() => prepareReasoningBuild(root)).toThrow("already prepared");
    restoreReasoningBuild(root);
    expect(readFileSync(manifestPath, "utf8")).toBe(original);
    expect(() => restoreReasoningBuild(root)).toThrow("No prepared reasoning pack");
    prepareReasoningBuild(root);
    // A process can stop after creating its journal but before writing the stamp.
    writeFileSync(manifestPath, original);
    restoreReasoningBuild(root);
    expect(readFileSync(manifestPath, "utf8")).toBe(original);
  });

  it("preserves concurrent developer edits and the recovery journal", () => {
    const { root, manifestPath } = fixture();
    prepareReasoningBuild(root);
    const changed = readFileSync(manifestPath, "utf8") + " \n";
    writeFileSync(manifestPath, changed);
    expect(() => restoreReasoningBuild(root)).toThrow("changed while packing");
    expect(readFileSync(manifestPath, "utf8")).toBe(changed);
    expect(readFileSync(path.join(root, "tmp/reasoning-build-package-backup.json"), "utf8")).toContain("stampedHash");
  });
});

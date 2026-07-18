import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArguments, scaffoldProject } from "../src/scaffold.mjs";

test("parses safe non-interactive arguments", () => {
  assert.deepEqual(parseArguments(["demo", "--no-install", "--yes"]), {
    targetDirectory: "demo",
    install: false,
    help: false,
    version: false,
  });
  assert.throws(() => parseArguments(["one", "two"]), /at most one/);
  assert.throws(() => parseArguments(["--force"]), /Unknown option/);
});

test("scaffolds the complete local decision project", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const result = await scaffoldProject({
    targetDirectory: "harborlight-demo",
    install: false,
    cwd: root,
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(result.projectName, "harborlight-demo");
  const expectedFiles = [
    ".gitignore",
    "README.md",
    "decision-context.json",
    "episodes/holdout.json",
    "ontology-pack.json",
    "package.json",
    "policies/baseline.json",
    "policies/candidate.json",
    "src/run.mjs",
  ];
  for (const relativePath of expectedFiles) {
    await fs.access(path.join(result.targetPath, relativePath));
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(result.targetPath, "package.json"), "utf8")
  );
  assert.equal(manifest.name, "harborlight-demo");
  assert.equal(manifest.dependencies["@t2kai/core"], "^0.1.0");
  assert.match(output.join(""), /human must still authorize/i);
});

test("refuses to overwrite a non-empty directory", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-block-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "existing");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "keep.txt"), "do not replace", "utf8");

  await assert.rejects(
    scaffoldProject({ targetDirectory: target, install: false }),
    /not empty/
  );
  assert.equal(
    await fs.readFile(path.join(target, "keep.txt"), "utf8"),
    "do not replace"
  );
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CREATE_T2K_PROFILES,
  parseArguments,
  scaffoldProject,
} from "../src/scaffold.mjs";

test("parses safe non-interactive arguments", () => {
  assert.deepEqual(parseArguments(["demo", "--no-install", "--yes"]), {
    targetDirectory: "demo",
    install: false,
    help: false,
    version: false,
    profile: "decision-loop",
  });
  assert.deepEqual(
    parseArguments([
      "integration-demo",
      "--profile",
      "integration-hub",
      "--no-install",
    ]),
    {
      targetDirectory: "integration-demo",
      install: false,
      help: false,
      version: false,
      profile: "integration-hub",
    }
  );
  assert.equal(
    parseArguments(["--profile=integration-hub"]).profile,
    "integration-hub"
  );
  assert.deepEqual(CREATE_T2K_PROFILES, ["decision-loop", "integration-hub"]);
  assert.throws(() => parseArguments(["one", "two"]), /at most one/);
  assert.throws(() => parseArguments(["--force"]), /Unknown option/);
  assert.throws(() => parseArguments(["--profile"]), /requires a profile name/);
  assert.throws(
    () => parseArguments(["--profile="]),
    /requires a profile name/
  );
  assert.throws(
    () => parseArguments(["--profile", "unknown"]),
    /Unsupported profile: unknown/
  );
  assert.throws(
    () =>
      parseArguments([
        "--profile",
        "decision-loop",
        "--profile=integration-hub",
      ]),
    /at most once/
  );
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
  assert.equal(result.profile, "decision-loop");
  const expectedFiles = [
    ".gitignore",
    "README.md",
    "compose.yml",
    "decision-context.json",
    "episodes/holdout.json",
    "ontology-pack.json",
    "package.json",
    "policies/baseline.json",
    "policies/candidate.json",
    "src/run.mjs",
    "src/lifecycle.mjs",
  ];
  for (const relativePath of expectedFiles) {
    await fs.access(path.join(result.targetPath, relativePath));
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(result.targetPath, "package.json"), "utf8")
  );
  assert.equal(manifest.name, "harborlight-demo");
  assert.equal(manifest.dependencies["@t2kai/core"], "0.4.3");
  assert.equal(manifest.scripts["db:down"], "docker compose down");
  assert.equal(manifest.scripts["db:reset"], "docker compose down -v");

  const compose = await fs.readFile(
    path.join(result.targetPath, "compose.yml"),
    "utf8"
  );
  assert.match(compose, /127\.0\.0\.1:55432:5432/);
  assert.doesNotMatch(compose, /- "55432:5432"/);
  assert.match(compose, /disposable local-only quickstart credentials/i);

  const generatedReadme = await fs.readFile(
    path.join(result.targetPath, "README.md"),
    "utf8"
  );
  assert.match(generatedReadme, /`t2k` username and\s+`t2k` password.*local-only/is);
  assert.match(generatedReadme, /`npm install` first only if.*`--no-install`/is);
  assert.doesNotMatch(generatedReadme, /```bash\s+npm install\s+npm start/);
  assert.match(generatedReadme, /bump the policy `version`/i);
  assert.match(generatedReadme, /bump\s+`ontologyVersion`/i);
  assert.match(generatedReadme, /already been\s+executed or persisted as immutable evidence/i);

  for (const relativePath of ["src/run.mjs", "src/lifecycle.mjs"]) {
    const runner = await fs.readFile(
      path.join(result.targetPath, relativePath),
      "utf8"
    );
    assert.match(runner, /Invalid JSON in \$\{relativePath\}/);
  }
  assert.match(output.join(""), /human must still authorize/i);
  assert.match(output.join(""), /persisted closed loop/i);
  assert.match(output.join(""), /db:reset.*delete its volume/i);
});

test("scaffolds the synthetic integration-hub profile", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-hub-test-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const result = await scaffoldProject({
    targetDirectory: "integration-hub-demo",
    profile: "integration-hub",
    install: false,
    cwd: root,
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(result.projectName, "integration-hub-demo");
  assert.equal(result.profile, "integration-hub");
  const expectedFiles = [
    ".gitignore",
    "README.md",
    "authority-policy.json",
    "ontology-pack.json",
    "package.json",
    "source-records/registry-alpha.json",
    "source-records/registry-beta.json",
    "src/run.mjs",
  ];
  for (const relativePath of expectedFiles) {
    await fs.access(path.join(result.targetPath, relativePath));
  }
  await assert.rejects(
    fs.access(path.join(result.targetPath, "src/lifecycle.mjs")),
    /ENOENT/
  );

  const manifest = JSON.parse(
    await fs.readFile(path.join(result.targetPath, "package.json"), "utf8")
  );
  assert.equal(manifest.name, "integration-hub-demo");
  assert.equal(manifest.dependencies["@t2kai/core"], "0.4.3");
  assert.equal(manifest.scripts.start, "node src/run.mjs");

  const ontology = JSON.parse(
    await fs.readFile(path.join(result.targetPath, "ontology-pack.json"), "utf8")
  );
  const conflictPolicies = ontology.sourceMappings[0].fieldMappings.map(
    (field) => field.conflictPolicy
  );
  assert.ok(conflictPolicies.includes("preserve_all"));
  assert.ok(conflictPolicies.includes("prefer_authority"));
  assert.equal(ontology.sourceMappings[0].humanCheckpoint, "always");

  const alpha = JSON.parse(
    await fs.readFile(
      path.join(result.targetPath, "source-records/registry-alpha.json"),
      "utf8"
    )
  );
  const beta = JSON.parse(
    await fs.readFile(
      path.join(result.targetPath, "source-records/registry-beta.json"),
      "utf8"
    )
  );
  assert.notEqual(alpha.sourceSystem, beta.sourceSystem);
  assert.notEqual(alpha.sourceRecordKey, beta.sourceRecordKey);
  assert.equal(alpha.authenticationState, "unknown");
  assert.equal(beta.authenticationState, "unknown");
  assert.equal(alpha.payload.party_key.trim().toUpperCase(), "SHARED-0042");
  assert.equal(beta.payload.party_key.trim().toUpperCase(), "SHARED-0042");

  const generatedReadme = await fs.readFile(
    path.join(result.targetPath, "README.md"),
    "utf8"
  );
  assert.match(generatedReadme, /every regular `source-records\/\*\.json`/i);
  assert.match(generatedReadme, /discovered automatically/i);
  assert.match(generatedReadme, /canonical record is paired with its complete source-mapping receipt/i);
  assert.match(generatedReadme, /forward-versus-reverse/i);
  assert.match(generatedReadme, /not every possible\s+ordering/i);
  assert.match(generatedReadme, /source envelope as immutable/i);
  assert.match(generatedReadme, /new\s+`sourceRecordKey`/i);
  assert.match(generatedReadme, /bump\s+`policyVersion`/i);
  assert.match(generatedReadme, /bump its `mappingVersion`/i);
  assert.match(generatedReadme, /also bump `ontologyVersion`/i);
  assert.match(generatedReadme, /`npm install` first only if.*`--no-install`/is);
  assert.doesNotMatch(generatedReadme, /```bash\s+npm install\s+npm start/);

  const runner = await fs.readFile(
    path.join(result.targetPath, "src/run.mjs"),
    "utf8"
  );
  assert.match(runner, /fs\.readdir\(sourceDirectory/);
  assert.match(runner, /sort\(compareCanonicalStrings\)/);
  assert.match(runner, /canonicalRecord: result\.canonicalRecord/);
  assert.match(runner, /receipt: result\.receipt/);
  assert.match(runner, /coreRuntime:/);
  assert.match(runner, /packageVersion: corePackageManifest\.version/);
  assert.match(runner, /proposal: reconciliation/);
  assert.match(runner, /reverseInputOrderProposal: reverseOrderReconciliation/);
  assert.match(runner, /comparisonScope: "forward_and_reverse_input_order_only"/);
  assert.match(runner, /issues: reconciliation\.issues/);
  assert.match(runner, /Invalid JSON in \$\{relativePath\}/);
  assert.doesNotMatch(runner, /deterministicAcrossInputOrder/);
  assert.doesNotMatch(runner, /registry-alpha\.json|registry-beta\.json/);

  assert.match(output.join(""), /deterministic evidence proposal for human review/i);
  assert.match(output.join(""), /does not authenticate/i);
  assert.match(output.join(""), /accepted truth/i);
});

test("rejects an invalid profile before creating its target", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-profile-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "must-not-exist");

  await assert.rejects(
    scaffoldProject({
      targetDirectory: target,
      profile: "not-a-profile",
      install: false,
    }),
    /Unsupported profile/
  );
  await assert.rejects(fs.access(target), /ENOENT/);
});

test("refuses to overwrite a non-empty directory", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-t2k-block-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "existing");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "keep.txt"), "do not replace", "utf8");

  await assert.rejects(
    scaffoldProject({
      targetDirectory: target,
      profile: "integration-hub",
      install: false,
    }),
    /not empty/
  );
  assert.equal(
    await fs.readFile(path.join(target, "keep.txt"), "utf8"),
    "do not replace"
  );
});

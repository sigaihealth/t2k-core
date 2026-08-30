import { spawnSync } from "node:child_process";
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
const mainRef = process.env.T2K_RELEASE_MAIN_REF || process.argv[3] || "origin/main";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function gitOutput(args, failureMessage) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) {
    fail(`${failureMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    fail(`${failureMessage}${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout.trim();
}

if (actualTag !== expectedTag) {
  fail(`Release tag ${actualTag || "<missing>"} must equal ${expectedTag}.`);
}

const tagRef = `refs/tags/${actualTag}`;
const tagType = gitOutput(
  ["cat-file", "-t", tagRef],
  `Release tag ${actualTag} is missing from the local checkout`
);
if (tagType !== "tag") {
  fail(
    `Release tag ${actualTag} must be an annotated tag object; lightweight tags are not publishable.`
  );
}

const tagObjectSha = gitOutput(
  ["rev-parse", "--verify", tagRef],
  `Could not resolve annotated tag ${actualTag}`
);
const releaseCommit = gitOutput(
  ["rev-parse", "--verify", `${tagRef}^{commit}`],
  `Release tag ${actualTag} does not peel to a commit`
);
const headCommit = gitOutput(
  ["rev-parse", "--verify", "HEAD^{commit}"],
  "Could not resolve the checked-out release commit"
);
if (releaseCommit !== headCommit) {
  fail(
    `Release tag ${actualTag} peels to ${releaseCommit}, but the checked-out commit is ${headCommit}.`
  );
}

const mainCommit = gitOutput(
  ["rev-parse", "--verify", `${mainRef}^{commit}`],
  `Release main reference ${mainRef} is missing; fetch origin/main before verification`
);
const ancestry = spawnSync(
  "git",
  ["merge-base", "--is-ancestor", releaseCommit, mainCommit],
  { cwd: process.cwd(), encoding: "utf8" }
);
if (ancestry.error) {
  fail(`Could not verify release ancestry: ${ancestry.error.message}`);
}
if (ancestry.status === 1) {
  fail(
    `Release commit ${releaseCommit} must be an ancestor of ${mainRef} (${mainCommit}).`
  );
}
if (ancestry.status !== 0) {
  const detail = ancestry.stderr.trim();
  fail(`Could not verify release ancestry${detail ? `: ${detail}` : "."}`);
}

const expectedTagObjectSha = process.env.T2K_RELEASE_TAG_OBJECT_SHA;
const expectedReleaseCommit = process.env.T2K_RELEASE_COMMIT_SHA;
const hasTagObjectExpectation = Boolean(expectedTagObjectSha);
const hasCommitExpectation = Boolean(expectedReleaseCommit);
if (
  process.env.GITHUB_ACTIONS === "true" &&
  (!hasTagObjectExpectation || !hasCommitExpectation)
) {
  fail(
    "GitHub Actions release verification requires GitHub-verified tag-object and commit SHA outputs."
  );
}
if (hasTagObjectExpectation !== hasCommitExpectation) {
  fail("Release verification must provide both tag-object and commit SHA expectations.");
}
if (expectedTagObjectSha && expectedTagObjectSha !== tagObjectSha) {
  fail(
    `GitHub verified tag object ${expectedTagObjectSha}, but the local tag object is ${tagObjectSha}.`
  );
}
if (expectedReleaseCommit && expectedReleaseCommit !== releaseCommit) {
  fail(
    `GitHub verified release commit ${expectedReleaseCommit}, but the local tag peels to ${releaseCommit}.`
  );
}

console.log(
  `Release tag ${actualTag} matches @t2kai/core ${manifest.version}, is annotated at ${tagObjectSha}, and peels to mainline commit ${releaseCommit}.`
);

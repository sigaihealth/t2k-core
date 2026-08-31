import { spawnSync } from "node:child_process";
import process from "node:process";

function gitOutput(cwd, args, failureMessage) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    throw new Error(`${failureMessage}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`${failureMessage}${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout.trim();
}

/** Shared fail-closed release gate for every publishable T2K package. */
export function verifyReleaseTag({
  actualTag,
  cwd = process.cwd(),
  environment = process.env,
  expectedTag,
  mainRef = "origin/main",
  packageLabel,
}) {
  if (actualTag !== expectedTag) {
    throw new Error(
      `Release tag ${actualTag || "<missing>"} must equal ${expectedTag}.`,
    );
  }

  const tagRef = `refs/tags/${actualTag}`;
  const tagType = gitOutput(
    cwd,
    ["cat-file", "-t", tagRef],
    `Release tag ${actualTag} is missing from the local checkout`,
  );
  if (tagType !== "tag") {
    throw new Error(
      `Release tag ${actualTag} must be an annotated tag object; lightweight tags are not publishable.`,
    );
  }

  const tagObjectSha = gitOutput(
    cwd,
    ["rev-parse", "--verify", tagRef],
    `Could not resolve annotated tag ${actualTag}`,
  );
  const releaseCommit = gitOutput(
    cwd,
    ["rev-parse", "--verify", `${tagRef}^{commit}`],
    `Release tag ${actualTag} does not peel to a commit`,
  );
  const headCommit = gitOutput(
    cwd,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Could not resolve the checked-out release commit",
  );
  if (releaseCommit !== headCommit) {
    throw new Error(
      `Release tag ${actualTag} peels to ${releaseCommit}, but the checked-out commit is ${headCommit}.`,
    );
  }

  const mainCommit = gitOutput(
    cwd,
    ["rev-parse", "--verify", `${mainRef}^{commit}`],
    `Release main reference ${mainRef} is missing; fetch origin/main before verification`,
  );
  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", releaseCommit, mainCommit],
    { cwd, encoding: "utf8" },
  );
  if (ancestry.error) {
    throw new Error(`Could not verify release ancestry: ${ancestry.error.message}`);
  }
  if (ancestry.status === 1) {
    throw new Error(
      `Release commit ${releaseCommit} must be an ancestor of ${mainRef} (${mainCommit}).`,
    );
  }
  if (ancestry.status !== 0) {
    const detail = ancestry.stderr.trim();
    throw new Error(
      `Could not verify release ancestry${detail ? `: ${detail}` : "."}`,
    );
  }

  const expectedTagObjectSha = environment.T2K_RELEASE_TAG_OBJECT_SHA;
  const expectedReleaseCommit = environment.T2K_RELEASE_COMMIT_SHA;
  const hasTagObjectExpectation = Boolean(expectedTagObjectSha);
  const hasCommitExpectation = Boolean(expectedReleaseCommit);
  if (
    environment.GITHUB_ACTIONS === "true" &&
    (!hasTagObjectExpectation || !hasCommitExpectation)
  ) {
    throw new Error(
      "GitHub Actions release verification requires GitHub-verified tag-object and commit SHA outputs.",
    );
  }
  if (hasTagObjectExpectation !== hasCommitExpectation) {
    throw new Error(
      "Release verification must provide both tag-object and commit SHA expectations.",
    );
  }
  if (expectedTagObjectSha && expectedTagObjectSha !== tagObjectSha) {
    throw new Error(
      `GitHub verified tag object ${expectedTagObjectSha}, but the local tag object is ${tagObjectSha}.`,
    );
  }
  if (expectedReleaseCommit && expectedReleaseCommit !== releaseCommit) {
    throw new Error(
      `GitHub verified release commit ${expectedReleaseCommit}, but the local tag peels to ${releaseCommit}.`,
    );
  }

  return `Release tag ${actualTag} matches ${packageLabel}, is annotated at ${tagObjectSha}, and peels to mainline commit ${releaseCommit}.`;
}

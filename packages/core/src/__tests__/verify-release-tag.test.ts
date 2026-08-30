import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const verifierPath = path.join(packageRoot, "scripts", "verify-release-tag.mjs");
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8")
) as { version: string };
const releaseTag = `core-v${manifest.version}`;
const temporaryRoots: string[] = [];

function git(repository: string, ...args: string[]) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return result.stdout.trim();
}

async function createRepository(options?: {
  lightweight?: boolean;
  offMain?: boolean;
}) {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), "t2k-core-release-verifier-")
  );
  temporaryRoots.push(repository);
  git(repository, "init", "--initial-branch=main");
  await fs.writeFile(path.join(repository, "tracked.txt"), "main\n");
  git(repository, "add", "tracked.txt");
  git(
    repository,
    "-c",
    "user.name=T2K Release Test",
    "-c",
    "user.email=release-test@example.invalid",
    "commit",
    "-m",
    "main"
  );
  git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");

  if (options?.offMain) {
    git(repository, "switch", "-c", "release-candidate");
    await fs.writeFile(path.join(repository, "candidate.txt"), "off main\n");
    git(repository, "add", "candidate.txt");
    git(
      repository,
      "-c",
      "user.name=T2K Release Test",
      "-c",
      "user.email=release-test@example.invalid",
      "commit",
      "-m",
      "off-main candidate"
    );
  }

  if (options?.lightweight) {
    git(repository, "tag", releaseTag);
  } else {
    git(
      repository,
      "-c",
      "user.name=T2K Release Test",
      "-c",
      "user.email=release-test@example.invalid",
      "tag",
      "-a",
      releaseTag,
      "-m",
      "release"
    );
  }
  return repository;
}

function runVerifier(
  repository: string,
  extraEnvironment: NodeJS.ProcessEnv = {}
) {
  const environment = { ...process.env };
  delete environment.GITHUB_ACTIONS;
  delete environment.GITHUB_REF_NAME;
  delete environment.T2K_RELEASE_COMMIT_SHA;
  delete environment.T2K_RELEASE_MAIN_REF;
  delete environment.T2K_RELEASE_TAG_OBJECT_SHA;
  Object.assign(environment, extraEnvironment);
  return spawnSync(process.execPath, [verifierPath, releaseTag], {
    cwd: repository,
    env: environment,
    encoding: "utf8",
  });
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("core release tag verifier", () => {
  it("accepts an annotated mainline tag bound to GitHub API object identities", async () => {
    const repository = await createRepository();
    const result = runVerifier(repository, {
      GITHUB_ACTIONS: "true",
      T2K_RELEASE_TAG_OBJECT_SHA: git(
        repository,
        "rev-parse",
        `refs/tags/${releaseTag}`
      ),
      T2K_RELEASE_COMMIT_SHA: git(
        repository,
        "rev-parse",
        `refs/tags/${releaseTag}^{commit}`
      ),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Release tag ${releaseTag} matches`);
  });

  it("rejects a lightweight release tag", async () => {
    const repository = await createRepository({ lightweight: true });
    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be an annotated tag object");
  });

  it("rejects an annotated release commit that is off origin/main", async () => {
    const repository = await createRepository({ offMain: true });
    const result = runVerifier(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be an ancestor of origin/main");
  });

  it("fails closed in GitHub Actions without API verification outputs", async () => {
    const repository = await createRepository();
    const result = runVerifier(repository, { GITHUB_ACTIONS: "true" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "requires GitHub-verified tag-object and commit SHA outputs"
    );
  });

  it("rejects a GitHub-verified object identity that differs from the local tag", async () => {
    const repository = await createRepository();
    const result = runVerifier(repository, {
      GITHUB_ACTIONS: "true",
      T2K_RELEASE_TAG_OBJECT_SHA: "0".repeat(40),
      T2K_RELEASE_COMMIT_SHA: git(
        repository,
        "rev-parse",
        `refs/tags/${releaseTag}^{commit}`
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("but the local tag object is");
  });
});

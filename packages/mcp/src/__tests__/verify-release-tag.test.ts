import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const verifierPath = path.join(packageRoot, "scripts", "verify-release-tag.mjs");
const manifest = JSON.parse(
  await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
) as { version: string };
const releaseTag = `mcp-v${manifest.version}`;
const temporaryRoots: string[] = [];

function git(repository: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

async function createRepository(lightweight = false) {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), "t2k-mcp-release-verifier-"),
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
    "main",
  );
  git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (lightweight) {
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
      "release",
    );
  }
  return repository;
}

function runVerifier(
  repository: string,
  extraEnvironment: NodeJS.ProcessEnv = {},
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
    roots.map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("MCP release tag verifier", () => {
  it("accepts an annotated mainline tag bound to GitHub object identities", async () => {
    const repository = await createRepository();
    const result = runVerifier(repository, {
      GITHUB_ACTIONS: "true",
      T2K_RELEASE_TAG_OBJECT_SHA: git(
        repository,
        "rev-parse",
        `refs/tags/${releaseTag}`,
      ),
      T2K_RELEASE_COMMIT_SHA: git(
        repository,
        "rev-parse",
        `refs/tags/${releaseTag}^{commit}`,
      ),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Release tag ${releaseTag} matches`);
  });

  it("rejects lightweight tags and unsigned GitHub workflow inputs", async () => {
    const lightweightRepository = await createRepository(true);
    const lightweight = runVerifier(lightweightRepository);
    expect(lightweight.status).toBe(1);
    expect(lightweight.stderr).toContain("must be an annotated tag object");

    const annotatedRepository = await createRepository();
    const unsigned = runVerifier(annotatedRepository, {
      GITHUB_ACTIONS: "true",
    });
    expect(unsigned.status).toBe(1);
    expect(unsigned.stderr).toContain(
      "requires GitHub-verified tag-object and commit SHA outputs",
    );
  });
});

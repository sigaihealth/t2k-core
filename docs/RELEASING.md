# Releasing the npm packages

Releases are built from the public repository and published by dedicated GitHub
Actions workflows. Tags must exactly match package versions:

| Package | Workflow | Tag for 0.1.0 |
| --- | --- | --- |
| `@t2kai/core` | `release-core.yml` | `core-v0.1.0` |
| `create-t2k` | `release-create-t2k.yml` | `create-t2k-v0.1.0` |

The npm namespace is `@t2kai`, matching `t2k.ai`. The `@t2k` namespace belongs
to an unrelated npm user and must not appear in package names or imports.

## Release Preconditions

1. `main` is clean and the intended commit passed Node 20 and 22 CI.
2. `npm run check` passes from a clean checkout.
3. `CHANGELOG.md` describes the release.
4. The target workspace `package.json` contains the intended version.
5. The npm trusted publisher names `sigaihealth/t2k-core`, the package's exact
   workflow filename, and publish permission.
6. `@t2kai/core` is published before a `create-t2k` version that depends on it.

## Publish

```bash
git tag -s core-v0.1.0 -m "@t2kai/core 0.1.0"
git push origin core-v0.1.0
git tag -s create-t2k-v0.1.0 -m "create-t2k 0.1.0"
git push origin create-t2k-v0.1.0
```

The workflow reruns the scrub, typecheck, tests, conformance suite, Harborlight
replay, dependency audit, and package smoke test before publishing. npm
provenance links the registry artifact to the exact public commit and workflow.

After the workflow succeeds, verify the registry rather than relying only on
the workflow result:

```bash
npm view @t2kai/core@0.1.0 version dist.integrity dist.tarball --json
npm install @t2kai/core@0.1.0
npm audit signatures
npm view create-t2k@0.1.0 version dist.integrity dist.tarball --json
npx create-t2k@0.1.0 release-smoke
```

## First-Publish Bootstrap

npm requires a package to exist before its trusted publisher can be configured.
The bootstrap completed on 2026-07-18 with provenance-backed `0.1.0` releases
for both packages. The one-time process was:

1. Create the free public `t2kai` npm organization and require account 2FA.
2. Create a short-lived granular publish token with the minimum permissions
   needed for the two initial public packages.
3. Store it temporarily as the repository secret `NPM_TOKEN`.
4. Push `core-v0.1.0`, verify it, then push `create-t2k-v0.1.0` so GitHub
   Actions performs both provenance-enabled publishes in dependency order.
5. Verify each registry tarball, its signature audit, and the generated-project
   smoke test before removing the bootstrap credential.

The temporary GitHub secret has been removed and the release workflows contain
no long-lived npm credential. Before another release, an npm organization owner
must complete these package settings:

1. Configure the `@t2kai/core` trusted publisher for repository
   `sigaihealth/t2k-core` and workflow `release-core.yml`.
2. Configure the `create-t2k` trusted publisher for the same repository and
   workflow `release-create-t2k.yml`.
3. Require 2FA and disallow traditional tokens for both packages.
4. Revoke the short-lived bootstrap token from the npm account.

Until those trust relationships exist, later release workflows fail closed.

## Failed Releases

Do not move or reuse a published version. Fix the cause, increment the package
version, update the changelog, and create a new signed tag. A tag whose workflow
failed before publication may be deleted and recreated only when the package
version was never accepted by npm.

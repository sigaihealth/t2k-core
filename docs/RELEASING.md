# Releasing `@t2kai/core`

Releases are built from the public repository and published by the
`release-core.yml` GitHub Actions workflow. A release tag must exactly match the
package version: version `0.1.0` uses tag `core-v0.1.0`.

The npm namespace is `@t2kai`, matching `t2k.ai`. The `@t2k` namespace belongs
to an unrelated npm user and must not appear in package names or imports.

## Release Preconditions

1. `main` is clean and the intended commit passed Node 20 and 22 CI.
2. `npm run check` passes from a clean checkout.
3. `CHANGELOG.md` describes the release.
4. `packages/core/package.json` contains the intended version.
5. The npm trusted publisher names `sigaihealth/t2k-core` and workflow file
   `release-core.yml` with publish permission.

## Publish

```bash
git tag -s core-v0.1.0 -m "@t2kai/core 0.1.0"
git push origin core-v0.1.0
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
```

## First-Publish Bootstrap

npm requires a package to exist before its trusted publisher can be configured.
For the first release only:

1. Create the free public `t2kai` npm organization and require account 2FA.
2. Create a short-lived granular publish token with the minimum permissions
   needed for the initial public package.
3. Store it temporarily as the repository secret `NPM_TOKEN`.
4. Push `core-v0.1.0` so GitHub Actions performs the provenance-enabled publish.
5. Configure the package trusted publisher for `sigaihealth/t2k-core`,
   `release-core.yml`, and publish permission.
6. Set publishing access to require 2FA and disallow traditional tokens.
7. Delete the GitHub secret and revoke the bootstrap token.
8. Remove `NODE_AUTH_TOKEN` from the workflow in the next signed commit.

No long-lived npm write credential should remain after bootstrap.

## Failed Releases

Do not move or reuse a published version. Fix the cause, increment the package
version, update the changelog, and create a new signed tag. A tag whose workflow
failed before publication may be deleted and recreated only when the package
version was never accepted by npm.

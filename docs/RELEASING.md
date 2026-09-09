# Releasing the npm packages

Releases are built from the public repository and published by dedicated GitHub
Actions workflows. Tags must exactly match package versions:

| Package | Workflow | Tag pattern |
| --- | --- | --- |
| `@t2kai/core` | `release-core.yml` | `core-vX.Y.Z` |
| `@t2kai/mcp` | `release-mcp.yml` | `mcp-vX.Y.Z` |
| `create-t2k` | `release-create-t2k.yml` | `create-t2k-vX.Y.Z` |

The npm namespace is `@t2kai`, matching `t2k.ai`. The `@t2k` namespace belongs
to an unrelated npm user and must not appear in package names or imports.

## Release Preconditions

1. `main` is clean and the intended commit passed Node 20 and 22 CI.
2. `npm run check` passes from a clean checkout.
3. `T2K_TEST_DATABASE_URL=... npm run check:postgres` passes against PostgreSQL 16.
4. The SSH tag-signing public key is registered with GitHub and a test tag or
   prior release tag reports a valid verified signature.
5. `CHANGELOG.md` describes the release.
6. The target workspace `package.json` contains the intended version.
7. The npm trusted publisher names `sigaihealth/t2k-core`, the package's exact
   workflow filename, and publish permission.
8. `@t2kai/core` is published before a `create-t2k` version that depends on it.
9. `@t2kai/core` is published before an `@t2kai/mcp` version that depends on it.

All three release workflows resolve each pushed tag through
GitHub's Git Database API and require an annotated tag whose signature GitHub
reports as verified. Each workflow binds that exact tag-object and peeled commit
to the local checkout, fetches `origin/main`, and requires the release commit to
be an ancestor of the fetched branch before any OIDC-backed publish can run.
Lightweight, unsigned, moved, and off-main tags fail closed.

The local verifier checks tag/version equality, annotated-tag structure,
checkout identity, and `origin/main` ancestry. GitHub signature verification is
performed separately by the mandatory API step after the tag is pushed.

## Release channels and dependency order

`scripts/release-channel.mjs` reads the package name/version and requires the
exact pushed tag. Canonical stable SemVer publishes with explicit `--tag latest`;
every canonical prerelease publishes with explicit `--tag next`. Missing tags,
wrong package prefixes, malformed versions and build metadata fail closed.
No workflow relies on npm's default tag or a user-supplied channel override.
`npm test` includes release-channel and workflow-wiring tests.

The earlier 0.5 coordinated release used:

| Stage | Core | create-t2k | MCP | npm tag |
| --- | --- | --- | --- | --- |
| Candidate | `0.5.0-rc.1` | `0.5.0-rc.1` | `0.4.0-rc.1` | `next` |
| Stable, after acceptance | `0.5.0` | `0.5.0` | `0.4.0` | `latest` |

The scaffolder must pin the exact Core version in both templates and tests. MCP's
Core dependency must resolve the coordinated build. Run package smoke tests in
clean temporary installations: the MCP check resolves Core from MCP's own entry,
not merely from the installation root, and checks the packed version and origin.

Publish Core first; verify its registry artifact, provenance and clean install;
then publish MCP and create-t2k, waiting for each workflow and registry check.
Use complete prerelease versions in signed tags, for example
`core-v0.5.0-rc.1`. A successful RC must leave existing `latest` tags unchanged.
Record both `next` and `latest` with `npm view <package> dist-tags --json`.

Core 0.6.0 is a Core-only release. Only `core-v0.6.0` is tagged and published.
MCP and scaffold source pins track Core 0.6.0 to preserve the exact-Core package
smoke gates, but their package versions and published artifacts remain unchanged.
Their next publication requires new package versions and the normal separate
signed tags; do not republish the existing MCP 0.4.0 or create-t2k 0.5.0 versions.
Use `npm install @t2kai/core@0.6.0` for the new distinct operator; the existing
published MCP/scaffolder commands continue to resolve their original Core 0.5.0.

## Core build identity

Core's pack lifecycle builds the executable distribution and stamps
`package.json.t2kReasoningBuild` with format `t2k.reasoning-build.v1`, `buildHash`,
and per-file `files` digests. The postpack lifecycle restores the working manifest;
ordinary builds must not dirty versioned metadata. If packing is interrupted
between stamping and restoration, run
`node packages/core/scripts/reasoning-build.mjs restore` from the repository root
before another pack. Recovery refuses to overwrite concurrent `package.json`
edits; preserve and reconcile those edits explicitly. Inspect the actual tarball and
a clean registry install, not only the source manifest. Package smoke checks must
verify all declared hashes and detect missing or changed executable bytes.

The manifest is an executable identity, not authenticity proof. Keep npm
provenance verification and a trusted host's independent acceptance process.

## Candidate acceptance and stable promotion

1. Publish the coordinated candidate packages with the gates above. Record exact
   registry versions, tarball integrity, provenance and dist-tags.
2. Install the published Core candidate in Studio with a committed exact version
   and lockfile. Verify its build identity and run Studio compatibility, unit,
   database, package and production-readiness checks.
3. Deploy Studio and revalidate its active function against the new executable
   identity. Preserve prior receipts. Use the reviewed frozen V2 suite and the
   explicit host revalidation/activation flow; no new model call is needed merely
   to migrate an existing candidate. Confirm a read-only execution and evidence.
4. Once candidate acceptance succeeds, change workspace versions, MCP dependency,
   both scaffold pins, tests, current README commands and release notes to the
   stable versions in the table. Rebuild and rerun the complete release checks.
5. Merge the stable release commit to protected `main`, create new signed stable
   tags, and publish through the same provenance-backed CI in dependency order.
   Stable packages are new immutable artifacts; never move an RC tag or label an
   RC tarball `latest` as a substitute for publishing stable versions.
6. Verify stable registry installations, signatures/provenance, dependency
   resolution and `latest` tags. Migrate Studio's exact dependency and lockfile to
   stable Core, then repeat its build-identity check, acceptance/revalidation,
   deployment and read-only operating smoke. A version change can change the
   host binding even when executable source behavior is unchanged.
7. Record the final release commit, published identities, Studio release,
   execution binding and operating receipt. Leave historical acceptance evidence
   attached to its original build.

Graph reasoning stays experimental after package promotion. Core 0.6.0 adds
explicit entity distinctness; arbitrary code, grouping, ranking, arithmetic,
disjunction and calls to other graph functions remain unsupported. See
[the capability and V2 migration contract](GRAPH_FUNCTIONS.md).

## Publish

Use explicit one-shot SSH-signing configuration so the command does not depend
on a contributor's global Git configuration. Push and verify each tag before
creating the next dependency tag; the release workflows do not serialize tags
for different packages.

```bash
git -c gpg.format=ssh -c user.signingkey=/path/to/release_signing_key \
  tag -s core-vX.Y.Z -m "@t2kai/core X.Y.Z"
npm run release:verify --workspace @t2kai/core -- core-vX.Y.Z
git push origin core-vX.Y.Z
# Wait for the core workflow and registry verification before continuing.

git -c gpg.format=ssh -c user.signingkey=/path/to/release_signing_key \
  tag -s mcp-vX.Y.Z -m "@t2kai/mcp X.Y.Z"
git push origin mcp-vX.Y.Z
# Wait for the MCP workflow and registry verification before continuing.

git -c gpg.format=ssh -c user.signingkey=/path/to/release_signing_key \
  tag -s create-t2k-vX.Y.Z -m "create-t2k X.Y.Z"
npm run release:verify --workspace create-t2k -- create-t2k-vX.Y.Z
git push origin create-t2k-vX.Y.Z
```

The workflow reruns the scrub, typecheck, tests, conformance suite, both
Harborlight paths, generated-project lifecycle, dependency audit, and package
smoke test against PostgreSQL 16 before publishing. npm provenance links the
registry artifact to the exact public commit and workflow.

After the workflow succeeds, verify the registry rather than relying only on
the workflow result:

```bash
npm view @t2kai/core@X.Y.Z version dist.integrity dist.tarball --json
npm install @t2kai/core@X.Y.Z
npm audit signatures
npm view @t2kai/mcp@X.Y.Z version dist.integrity dist.tarball --json
npx -y @t2kai/mcp@X.Y.Z --help
npm view create-t2k@X.Y.Z version dist.integrity dist.tarball --json
npx create-t2k@X.Y.Z release-smoke
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

The bootstrap hardening also completed on 2026-07-18:

1. `@t2kai/core` trusts `sigaihealth/t2k-core` workflow `release-core.yml` for
   `npm publish`.
2. `create-t2k` trusts the same repository's `release-create-t2k.yml` workflow
   for `npm publish`.
3. Both packages require 2FA and disallow traditional publishing tokens.
4. The temporary GitHub secret and bootstrap npm token were removed, and the
   release workflows contain no long-lived npm credential.

Later release workflows authenticate with short-lived GitHub OIDC credentials
and fail closed if their repository or workflow identity does not match these
package-level trust relationships.

The MCP package completed its separate bootstrap on 2026-07-18:

1. `@t2kai/mcp@0.1.0` was created through interactive npm web authentication;
   no npm token or repository secret was introduced.
2. A clean registry install verified the executable, five-tool safe default,
   live stdio call, vulnerability audit, and registry signatures.
3. The package now trusts only `sigaihealth/t2k-core` workflow
   `release-mcp.yml` for automated `npm publish` operations.
4. Package publishing requires 2FA and disallows traditional publish tokens.

Because npm cannot configure a trusted publisher before a package exists, the
bootstrap `0.1.0` artifact has a registry signature but no GitHub provenance
attestation. Every later MCP release uses the OIDC workflow and receives
automatic provenance.

## Failed Releases

Do not move or reuse a published version. Fix the cause, increment the package
version, update the changelog, and create a new signed tag. A tag whose workflow
failed before publication may be deleted and recreated only when the package
version was never accepted by npm.

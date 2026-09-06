import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { selectReleaseChannel } from "./release-channel.mjs";

const packages = [
  ["@t2kai/core", "core-v", "core"],
  ["@t2kai/mcp", "mcp-v", "mcp"],
  ["create-t2k", "create-t2k-v", "create-t2k"],
];
for (const [packageName, prefix, workspace] of packages) {
  test(`${packageName} publishes canonical stable versions only to latest`, () => {
    for (const version of ["0.5.0", "0.4.0", "1.0.0"]) {
      assert.equal(selectReleaseChannel({ packageName, version, tag: prefix + version }), "latest");
    }
  });
  test(`${packageName} publishes every prerelease only to next`, () => {
    for (const version of ["0.5.0-rc.1", "0.5.0-beta.2", "1.0.0-0", "1.0.0-preview-a.9"]) {
      assert.equal(selectReleaseChannel({ packageName, version, tag: prefix + version }), "next");
    }
  });
  test(`${packageName} rejects missing, mismatched and noncanonical release identities`, () => {
    for (const version of [undefined, "", "v0.5.0", "0.5", "00.5.0", "0.5.00", "0.5.0-01", "0.5.0-rc..1", "0.5.0+build", "0.5.0\n", "9007199254740992.5.0", "0.5.0-" + "a".repeat(251)]) {
      assert.throws(() => selectReleaseChannel({ packageName, version, tag: prefix + version }));
    }
    for (const tag of [undefined, "latest", prefix + "0.5.0", prefix + "0.5.0-rc.2"]) {
      assert.throws(() => selectReleaseChannel({ packageName, version: "0.5.0-rc.1", tag }));
    }
  });
  test(`${packageName} workflow binds an explicit publish channel and retains trust gates`, async () => {
    const source = await fs.readFile(new URL(`../.github/workflows/release-${workspace}.yml`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`node scripts/release-channel\\.mjs packages/${workspace}/package\\.json`));
    assert.match(source, /npm publish[^\n]+--tag "\$RELEASE_CHANNEL"[^\n]+--provenance/);
    assert.match(source, /RELEASE_CHANNEL: \$\{\{ steps\.release-channel\.outputs\.channel \}\}/);
    assert.match(source, /tag\.verification\?\.verified/);
    assert.match(source, /T2K_RELEASE_MAIN_REF: refs\/remotes\/origin\/main/);
    assert.match(source, /T2K_RELEASE_TAG_OBJECT_SHA: \$\{\{ steps\.github-release-tag\.outputs\.tag-object-sha \}\}/);
  });
}

test("unknown package cannot select a publishing channel", () => {
  assert.throws(() => selectReleaseChannel({ packageName: "other", version: "0.5.0", tag: "core-v0.5.0" }));
});

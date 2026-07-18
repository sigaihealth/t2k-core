import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const workspaceRoot = path.resolve(packageRoot, "../..");
const smokeRoot = await mkdtemp(path.join(tmpdir(), "t2k-core-smoke-"));

const smokeProgram = String.raw`
import { T2kClient, parseOntologyPackManifest } from "@t2k/core";
import { compileOntologyPackSet } from "@t2k/core/compiler";
import { readFile } from "node:fs/promises";

const manifest = {
  manifestType: "t2k.ontology-pack",
  manifestVersion: "1.0",
  ontologyVersion: "1.0.0",
  ontologyId: "smoke",
  label: "Smoke",
  description: "External package smoke test",
  packKind: "core",
  status: "accepted",
  scope: {
    domain: "test",
    description: "Test scope",
    jurisdictions: [],
    industries: [],
    businessStages: [],
    organizationSizes: [],
    exclusions: [],
  },
  extends: [],
  contextDimensions: [],
  objectTypes: [{
    id: "business",
    label: "Business",
    family: "Operating entity",
    nodeKind: "operating-entity",
    identity: ["name"],
    purpose: "Represents a business",
    properties: [{
      id: "name",
      valueType: "string",
      required: true,
      description: "Name",
      authorityDomain: "identity",
      temporal: false,
    }],
  }],
};

const parsed = parseOntologyPackManifest(manifest);
const compiled = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: "smoke", version: "^1.0.0" }],
});
const schemaUrl = import.meta.resolve(
  "@t2k/core/schema/t2k-ontology-pack.v1.json"
);
const schema = JSON.parse(await readFile(new URL(schemaUrl), "utf8"));
const client = new T2kClient({ baseUrl: "https://studio.t2k.ai/" });

if (
  !parsed ||
  compiled.status !== "valid" ||
  compiled.packs.length !== 1 ||
  schema.title !== "T2K Ontology Pack Manifest" ||
  !client
) {
  throw new Error("Installed package did not satisfy the public contract.");
}
`;

try {
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "@t2k/core",
        "--pack-destination",
        smokeRoot,
        "--silent",
        "--json",
      ],
      { cwd: workspaceRoot, encoding: "utf8" }
    )
  );
  const tarball = path.join(smokeRoot, packResult[0].filename);

  await writeFile(
    path.join(smokeRoot, "package.json"),
    JSON.stringify({ name: "t2k-core-smoke", private: true, type: "module" })
  );
  execFileSync(
    "npm",
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: smokeRoot, stdio: "inherit" }
  );
  execFileSync(process.execPath, ["--input-type=module", "--eval", smokeProgram], {
    cwd: smokeRoot,
    stdio: "inherit",
  });

  const installedManifest = JSON.parse(
    await readFile(
      path.join(smokeRoot, "node_modules/@t2k/core/package.json"),
      "utf8"
    )
  );
  console.log(`Packed @t2k/core@${installedManifest.version} smoke test passed.`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

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
import {
  T2kClient,
  canonicalSourceMappingHash,
  parseOntologyPackManifest,
  reconcileCanonicalRecords,
} from "@t2kai/core";
import { compileOntologyPackSet } from "@t2kai/core/compiler";
import {
  compileGraphFunction,
  executeGraphFunction,
  generateGraphFunction,
  graphGenerationOntologyContext,
  graphGenerationProgramSchema,
} from "@t2kai/core/reasoning";
import {
  PostgresReferenceLifecycle,
  computeReferenceReconciliationProposalHash,
} from "@t2kai/core/postgres";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import Ajv from "ajv";

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
const reasoningOntology = {
  manifests: [{
    ...manifest,
    reasoningFunctions: [{ id: "names", input: "Business view", output: "Names", humanCheckpoint: "Review before use" }],
  }],
  roots: [{ ontologyId: "smoke", version: "1.0.0" }],
  mode: "deployment",
};
const reasoningResolution = compileOntologyPackSet(reasoningOntology);
const reasoningDefinition = {
  artifactVersion: "t2k.graph-function.v1",
  functionRef: "smoke:reasoning_function:names",
  ontologyResolutionHash: reasoningResolution.resolutionHash,
  inputs: {},
  output: { kind: "rows", fields: { name: "string" } },
  maxAgeSeconds: 3600,
  limits: { maxRows: 10, maxWork: 100 },
  steps: [
    { id: "businesses", op: "lookup", typeRef: "smoke:business", as: "business" },
    { id: "names", op: "project", from: "businesses", fields: { name: { binding: "business", property: "smoke:business.name" } } },
  ],
  return: "names",
};
const reasoningFunction = compileGraphFunction({ ontology: reasoningOntology, definition: reasoningDefinition });
const reasoningGraph = {
  snapshotVersion: "t2k.reasoning-graph.v1", graphKey: "synthetic.smoke",
  asOf: "2026-09-05T12:00:00Z", ontologyResolutionHash: reasoningResolution.resolutionHash,
  coverage: "complete", entities: [{ entityId: "business-1", typeRef: "smoke:business" }],
  claims: [{
    claimId: "business-name", revision: "1", subjectId: "business-1", predicateRef: "smoke:business.name",
    value: "Synthetic Business", status: "accepted", polarity: "positive", observedAt: "2026-09-05T12:00:00Z",
    evidence: [{ sourceRef: "synthetic://smoke", locator: "name" }],
  }],
};
const reasoningResult = executeGraphFunction({
  compiled: reasoningFunction,
  graph: reasoningGraph,
  arguments: {},
  context: { graphKey: "synthetic.smoke", asOf: "2026-09-05T12:00:00Z" },
});
if (reasoningResult.status !== "complete" || reasoningResult.value[0].name !== "Synthetic Business" ||
  reasoningResult.authorization !== "not_authorized" || reasoningResult.supportingClaimIds[0] !== "business-name") {
  throw new Error("Installed reasoning subpath did not execute the evidence-bound function.");
}
const { steps, return: returned, ...template } = reasoningDefinition;
const generationContract = {
  task: "Return the name of every business with supporting claim evidence.",
  ontology: reasoningOntology,
  template,
  maximumAttempts: 2,
  trainingCases: [{
    caseId: "development-business-name",
    graph: reasoningGraph,
    arguments: {},
    expected: {
      status: "complete",
      value: [{ name: "Synthetic Business" }],
      evidence: { supportingClaimIds: ["business-name"], consideredClaimIds: [], exclusions: [], rows: [] },
    },
    forbiddenRows: [],
  }],
};
const program = { steps, return: returned };
const faultyProgram = structuredClone(program);
faultyProgram.steps[1].fields.name = { literal: "Incorrect business" };
const checkpoints = [];
let providerCalls = 0;
const generation = await generateGraphFunction(generationContract, async (request) => {
  providerCalls++;
  // The next request must wait for the prior durable checkpoint to complete.
  assert.equal(checkpoints.length, request.attempt - 1);
  const programSchema = graphGenerationProgramSchema(request);
  const validateProgram = new Ajv({ strict: true }).compile(programSchema);
  assert.equal(validateProgram(program), true, JSON.stringify(validateProgram.errors));
  const wrongType = structuredClone(program);
  wrongType.steps[1].fields.name = { literal: 42 };
  assert.equal(validateProgram(wrongType), false);
  const context = graphGenerationOntologyContext(request);
  assert.equal(context.fullResolutionHash, reasoningResolution.resolutionHash);
  assert.ok(context.mapping.some((item) => item.definitionKey === template.functionRef));
  for (const mapping of context.mapping) {
    assert.equal(mapping.contentHash, reasoningResolution.definitions.find((item) => item.definitionKey === mapping.definitionKey)?.contentHash);
  }
  return request.attempt === 1 ? faultyProgram : program;
}, {
  onAttempt: async (attempt) => {
    await new Promise((resolve) => setImmediate(resolve));
    checkpoints.push(attempt.status);
  },
});
assert.equal(providerCalls, 2);
assert.deepEqual(checkpoints, ["training_failed", "ready"]);
assert.equal(generation.status, "ready_for_evaluation");
assert.equal(generation.authorization, "not_authorized");
assert.equal(generation.functionHash, reasoningFunction.functionHash);
const compiled = compileOntologyPackSet({
  manifests: [manifest],
  roots: [{ ontologyId: "smoke", version: "^1.0.0" }],
});
const schemaUrl = import.meta.resolve(
  "@t2kai/core/schema/t2k-ontology-pack.v1.json"
);
const schema = JSON.parse(await readFile(new URL(schemaUrl), "utf8"));
const client = new T2kClient({ baseUrl: "https://studio.t2k.ai/" });
if (typeof canonicalSourceMappingHash !== "function") {
  throw new Error("The public canonical source-mapping hash helper is missing.");
}
const reconciliationHash = computeReferenceReconciliationProposalHash({
  proposalKey: "smoke:proposal-1",
  objectType: "business",
  objectKey: "business-1",
  baseRevisionId: null,
  proposedContent: { name: "Synthetic Business" },
  evidence: { synthetic: true },
  executionReceiptIds: [],
  requiredReviewerRole: "records_steward",
  rationale: "Verify the packed reconciliation hash export.",
});

if (
  !parsed ||
  compiled.status !== "valid" ||
  compiled.packs.length !== 1 ||
  schema.title !== "T2K Ontology Pack Manifest" ||
  typeof PostgresReferenceLifecycle !== "function" ||
  !/^[0-9a-f]{64}$/.test(reconciliationHash) ||
  typeof reconcileCanonicalRecords !== "function" ||
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
        "@t2kai/core",
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
      path.join(smokeRoot, "node_modules/@t2kai/core/package.json"),
      "utf8"
    )
  );
  console.log(`Packed @t2kai/core@${installedManifest.version} smoke test passed.`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

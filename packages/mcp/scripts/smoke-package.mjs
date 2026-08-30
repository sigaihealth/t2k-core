import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(packageRoot, "../..");
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "t2k-mcp-package-"));

const smokeProgram = String.raw`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const binary = process.argv[1];
const client = new Client({ name: "t2k-mcp-package-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({ command: binary, stderr: "pipe" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  if (
    !names.includes("evaluate_reference_policy") ||
    !names.includes("map_governed_source_record") ||
    !names.includes("propose_canonical_reconciliation") ||
    !names.includes("propose_entity_link") ||
    !names.includes("evaluate_purpose_limited_access") ||
    names.includes("authorize_recommendation") ||
    names.includes("promote_learning_candidate")
  ) {
    throw new Error("Packed MCP server advertised an unsafe or incomplete tool set.");
  }

  const result = await client.callTool({
    name: "evaluate_reference_policy",
    arguments: {
      specification: {
        referencePolicy: {
          rules: [],
          defaultAction: "hold",
          evaluation: {
            minimumEpisodes: 20,
            minimumImprovement: 0.05,
            confidenceZ: 1.96,
            minimumCoverage: 0.2
          }
        }
      },
      state: {},
      legacyIgnoredField: "preserve-compatible-stripping"
    }
  });
  if (result.structuredContent?.result !== "hold") {
    throw new Error("Packed MCP server did not execute the reference policy.");
  }

  const mapping = {
    id: "synthetic:smoke-person-v1",
    mappingVersion: "1.0.0",
    sourceType: "api",
    sourceLocator: "synthetic://smoke-person",
    sourceSchemaVersion: "1.0.0",
    object: "synthetic:person",
    fieldMappings: [
      {
        sourcePath: "$.externalId",
        targetProperty: "synthetic:person.external_id",
        required: true,
        normalizations: ["trim", "uppercase"],
        valueMap: {},
        authorityDomain: "identity",
        conflictPolicy: "preserve_all"
      },
      {
        sourcePath: "$.displayName",
        targetProperty: "synthetic:person.display_name",
        required: true,
        normalizations: ["collapse_whitespace"],
        valueMap: {},
        authorityDomain: "identity",
        conflictPolicy: "prefer_authority"
      }
    ],
    targetIdentity: ["synthetic:person.external_id"],
    idempotencyPath: "$.messageId",
    eventTimePath: "$.eventTime",
    observedTimePath: "$.observedTime",
    authority: "synthetic-smoke",
    riskTier: "restricted",
    reviewStatus: "accepted",
    driftPolicy: "reject",
    lateArrivalPolicy: "reject",
    humanCheckpoint: "none",
    replayable: true
  };
  const sourceArguments = (recordKey, authorityRef, displayName) => ({
    mapping,
    envelope: {
      sourceSystem: "synthetic:" + recordKey,
      sourceLocator: "synthetic:" + recordKey + "/record",
      sourceRecordKey: recordKey,
      sourceSchemaVersion: "1.0.0",
      payload: {
        messageId: recordKey,
        eventTime: "2026-08-29T17:00:00.000Z",
        observedTime: "2026-08-29T17:00:05.000Z",
        externalId: " person-123 ",
        displayName
      },
      eventTime: "2026-08-29T17:00:00.000Z",
      observedTime: "2026-08-29T17:00:05.000Z",
      authenticationState: "unknown",
      authorityRef,
      dataClassification: "synthetic_restricted",
      purposeTags: ["package_smoke"],
      retentionPolicy: { schedule: "synthetic-test-only" }
    }
  });
  const mapRecord = async (recordKey, authorityRef, displayName) => {
    const response = await client.callTool({
      name: "map_governed_source_record",
      arguments: sourceArguments(recordKey, authorityRef, displayName)
    });
    if (response.isError || response.structuredContent?.result?.receipt?.status !== "mapped") {
      throw new Error("Packed MCP server did not map governed source evidence.");
    }
    return response.structuredContent.result;
  };
  const masterMapped = await mapRecord(
    "smoke-master",
    "authority:master",
    "Ada Lovelace"
  );
  const secondaryMapped = await mapRecord(
    "smoke-secondary",
    "authority:secondary",
    "Augusta Ada King"
  );
  const reconciliationArguments = {
    results: [secondaryMapped, masterMapped],
    authorityPolicy: {
      policyId: "synthetic:smoke-authority",
      policyVersion: "1.0.0",
      prioritiesByDomain: {
        identity: ["authority:master", "authority:secondary"]
      }
    }
  };
  const reconciliation = await client.callTool({
    name: "propose_canonical_reconciliation",
    arguments: reconciliationArguments
  });
  if (
    reconciliation.isError ||
    reconciliation.structuredContent?.result?.status !== "proposed" ||
    reconciliation.structuredContent?.result?.nonMutating !== true ||
    reconciliation.structuredContent?.result?.alternativesPreserved !== true
  ) {
    throw new Error("Packed MCP server did not produce a safe reconciliation proposal.");
  }

  const entityArguments = {
    sourceEntityKey: "source:smoke-person",
    identifiers: { external_id: "PERSON-123" },
    candidates: [
      {
        entityKey: "entity:other",
        identifiers: { external_id: "PERSON-999" }
      },
      {
        entityKey: "entity:master",
        identifiers: { external_id: "PERSON-123" }
      }
    ],
    rules: [
      {
        identifier: "external_id",
        weight: 1,
        requiredForAutomaticMatch: true
      }
    ]
  };
  const entityLink = await client.callTool({
    name: "propose_entity_link",
    arguments: entityArguments
  });
  if (
    entityLink.isError ||
    entityLink.structuredContent?.result?.status !== "matched" ||
    entityLink.structuredContent?.result?.targetEntityKey !== "entity:master" ||
    entityLink.structuredContent?.result?.reversible !== true
  ) {
    throw new Error("Packed MCP server did not produce a reversible entity-link proposal.");
  }

  const accessArguments = {
    policy: {
      policyId: "synthetic:smoke-access",
      policyVersion: "1.0.0",
      defaultEffect: "deny",
      rules: []
    },
    request: {
      requestKey: "smoke-request",
      principalId: "principal:smoke",
      principalRoles: ["reader"],
      purpose: "smoke_test",
      subjectRef: "synthetic:subject",
      subjectRelationship: "none",
      dataCategories: ["summary"],
      jurisdiction: "WA",
      requestedAt: "2026-08-29T17:00:00.000Z",
      sourceRecordRefs: ["synthetic:record"]
    }
  };
  const access = await client.callTool({
    name: "evaluate_purpose_limited_access",
    arguments: accessArguments
  });
  if (
    access.structuredContent?.result?.decision !== "deny" ||
    access.structuredContent?.result?.reasonCode !== "default_deny"
  ) {
    throw new Error("Packed MCP server did not fail closed for default-deny access.");
  }

  const strictToolCases = [
    [
      "map_governed_source_record",
      sourceArguments("smoke-top-level", "authority:source", "Ada Lovelace")
    ],
    ["propose_canonical_reconciliation", reconciliationArguments],
    ["propose_entity_link", entityArguments],
    ["evaluate_purpose_limited_access", accessArguments]
  ];
  for (const [name, baseArguments] of strictToolCases) {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const argumentsWithUnsafeKey = structuredClone(baseArguments);
      Object.defineProperty(argumentsWithUnsafeKey, key, {
        configurable: true,
        enumerable: true,
        value: { polluted: true },
        writable: true
      });
      let errorText = "";
      let errorCode;
      try {
        const unsafeResponse = await client.callTool({
          name,
          arguments: argumentsWithUnsafeKey
        });
        errorText = (unsafeResponse.content ?? [])
          .filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n");
      } catch (error) {
        errorText = String(error);
        errorCode =
          error !== null && typeof error === "object" && "code" in error
            ? error.code
            : undefined;
      }
      if (errorCode !== -32602 || !errorText.includes("Unsafe own key")) {
        throw new Error(
          "Packed MCP server did not reject unsafe top-level " +
            key +
            " for " +
            name +
            " with JSON-RPC Invalid params."
        );
      }
    }

    const argumentsWithOrdinaryUnknown = structuredClone(baseArguments);
    argumentsWithOrdinaryUnknown.ordinaryUnknown = true;
    const ordinaryUnknown = await client.callTool({
      name,
      arguments: argumentsWithOrdinaryUnknown
    });
    const ordinaryUnknownText = (ordinaryUnknown.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    if (!ordinaryUnknown.isError || !ordinaryUnknownText.includes("Unrecognized key")) {
      throw new Error(
        "Packed MCP server did not reject an ordinary unknown key for " + name + "."
      );
    }
  }
} finally {
  await client.close();
}
`;

const rawStdioProgram = String.raw`
import { spawn } from "node:child_process";
import readline from "node:readline";

const binary = process.argv[1];
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
const responses = new Map();
const output = readline.createInterface({ input: child.stdout });
let nextId = 1;
let stderr = "";

child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});
output.on("line", (line) => {
  const message = JSON.parse(line);
  const settle = responses.get(message.id);
  if (settle) {
    responses.delete(message.id);
    settle.resolve(message);
  }
});

const sendRequest = (method, params) => {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      responses.delete(id);
      reject(
        new Error("Timed out waiting for raw stdio response to " + method + ".")
      );
    }, 5_000);
    responses.set(id, {
      resolve(response) {
        clearTimeout(timeout);
        resolve(response);
      }
    });
    child.stdin.write(JSON.stringify(message) + "\n");
  });
};

const defineOwnKey = (target, key, value = { polluted: true }) => {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
  return target;
};

const legacyArguments = {
  specification: {
    referencePolicy: {
      rules: [],
      defaultAction: "hold",
      evaluation: {
        minimumEpisodes: 20,
        minimumImprovement: 0.05,
        confidenceZ: 1.96,
        minimumCoverage: 0.2
      }
    }
  },
  state: {}
};

try {
  const initialized = await sendRequest("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t2k-mcp-raw-stdio-smoke", version: "1.0.0" }
  });
  if (!initialized.result?.serverInfo) {
    throw new Error("Packed MCP server did not initialize over raw stdio.");
  }
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }) + "\n"
  );

  for (const key of ["__proto__", "constructor", "prototype"]) {
    const argumentsWithUnsafeKey = defineOwnKey(
      structuredClone(legacyArguments),
      key
    );
    const rejection = await sendRequest("tools/call", {
      name: "evaluate_reference_policy",
      arguments: argumentsWithUnsafeKey
    });
    if (
      rejection.error?.code !== -32602 ||
      !rejection.error?.message?.includes("Unsafe own key")
    ) {
      throw new Error(
        "Raw stdio did not reject " +
          key +
          " with JSON-RPC Invalid params: " +
          JSON.stringify(rejection)
      );
    }
  }

  const nestedArguments = structuredClone(legacyArguments);
  defineOwnKey(nestedArguments.state, "__proto__");
  const nestedRejection = await sendRequest("tools/call", {
    name: "evaluate_reference_policy",
    arguments: nestedArguments
  });
  if (
    nestedRejection.error?.code !== -32602 ||
    !nestedRejection.error?.message?.includes("Unsafe own key")
  ) {
    throw new Error(
      "Raw stdio did not reject a nested unsafe key with JSON-RPC Invalid params."
    );
  }

  const valid = await sendRequest("tools/call", {
    name: "evaluate_reference_policy",
    arguments: { ...legacyArguments, legacyIgnoredField: true }
  });
  if (valid.result?.structuredContent?.result !== "hold") {
    throw new Error("Raw stdio guard broke legacy compatible execution.");
  }
  if ({}.polluted !== undefined) {
    throw new Error("Raw stdio smoke observed prototype pollution.");
  }
} finally {
  child.kill();
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (stderr.trim()) {
    throw new Error(
      "Packed MCP raw stdio process wrote to stderr: " + stderr.trim()
    );
  }
}
`;

try {
  const corePackResult = JSON.parse(
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
      { cwd: workspaceRoot, encoding: "utf8" },
    ),
  );
  const coreTarball = path.join(smokeRoot, corePackResult[0].filename);
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "@t2kai/mcp",
        "--pack-destination",
        smokeRoot,
        "--silent",
        "--json",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    ),
  );
  const tarball = path.join(smokeRoot, packResult[0].filename);
  await fs.writeFile(
    path.join(smokeRoot, "package.json"),
    `${JSON.stringify({ name: "t2k-mcp-smoke", private: true, type: "module" })}\n`,
    "utf8",
  );
  execFileSync(
    "npm",
    [
      "install",
      coreTarball,
      tarball,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: smokeRoot, stdio: "inherit" },
  );
  const installedLock = JSON.parse(
    await fs.readFile(path.join(smokeRoot, "package-lock.json"), "utf8"),
  );
  const installedCoreResolution =
    installedLock.packages?.["node_modules/@t2kai/core"]?.resolved;
  if (
    typeof installedCoreResolution !== "string" ||
    !installedCoreResolution.includes(path.basename(coreTarball))
  ) {
    throw new Error(
      "Packed MCP smoke did not resolve @t2kai/core from the local tarball.",
    );
  }

  const binary = path.join(
    smokeRoot,
    "node_modules/.bin",
    process.platform === "win32" ? "t2k-mcp.cmd" : "t2k-mcp",
  );
  const help = execFileSync(binary, ["--help"], {
    cwd: smokeRoot,
    encoding: "utf8",
  });
  if (!help.includes("Human approval")) {
    throw new Error("Packed MCP CLI did not document its governance boundary.");
  }
  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", smokeProgram, binary],
    { cwd: smokeRoot, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", rawStdioProgram, binary],
    { cwd: smokeRoot, stdio: "inherit" },
  );
  console.log("Packed @t2kai/mcp stdio smoke test passed.");
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
}

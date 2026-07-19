import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import {
  T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS,
  createT2kMcpRuntime,
  type T2kMcpRuntime,
} from "../server.js";

const specification = {
  referencePolicy: {
    rules: [
      {
        all: [{ path: "risk", operator: "gte", value: 0.7 }],
        action: "review",
      },
    ],
    defaultAction: "proceed",
    evaluation: {
      minimumEpisodes: 20,
      minimumImprovement: 0.05,
      confidenceZ: 1.96,
      minimumCoverage: 0.2,
    },
  },
};

async function connect(runtime: T2kMcpRuntime) {
  const client = new Client({ name: "t2k-mcp-test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function structuredResult(value: { structuredContent?: Record<string, unknown> }) {
  return value.structuredContent?.result;
}

describe("T2K MCP semantic mode", () => {
  it("advertises and executes the database-free tools", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "validate_ontology_pack",
        "compile_ontology_pack_set",
        "evaluate_reference_policy",
        "evaluate_reference_replay",
        "evaluate_reference_reward",
      ]);
      expect(
        names.filter((name) =>
          T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS.includes(
            name as (typeof T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS)[number]
          )
        )
      ).toEqual([]);

      const evaluated = await client.callTool({
        name: "evaluate_reference_policy",
        arguments: { specification, state: { risk: 0.8 } },
      });
      expect(evaluated.isError).not.toBe(true);
      expect(structuredResult(evaluated)).toBe("review");

      const invalid = await client.callTool({
        name: "validate_ontology_pack",
        arguments: { manifest: { ontologyId: "incomplete" } },
      });
      expect(structuredResult(invalid)).toMatchObject({ valid: false });

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      const body = JSON.parse(capabilities.contents[0]?.text ?? "{}") as {
        mode?: string;
        mutationToolsEnabled?: boolean;
        omittedHumanGovernanceOperations?: string[];
      };
      expect(body).toMatchObject({
        mode: "semantic-only",
        mutationToolsEnabled: false,
        omittedHumanGovernanceOperations: [
          ...T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS,
        ],
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("returns governed validation errors without throwing a protocol error", async () => {
    const runtime = await createT2kMcpRuntime();
    const client = await connect(runtime);

    try {
      const result = await client.callTool({
        name: "evaluate_reference_policy",
        arguments: { specification: { referencePolicy: {} }, state: {} },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("referencePolicy"),
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("rejects unsafe mutation configurations before opening a transport", async () => {
    await expect(
      createT2kMcpRuntime({ allowMutations: true, actorId: "agent:test" })
    ).rejects.toThrow("Postgres lifecycle");
    await expect(
      createT2kMcpRuntime({
        connectionString: "postgresql://unused.invalid/t2k",
        allowMutations: true,
      })
    ).rejects.toThrow("fixed actorId");
  });
});

describe("T2K MCP mutation boundary", () => {
  it("adds lifecycle reads without writes when only a database is configured", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: "postgresql://unused.invalid/t2k",
    });
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain("get_active_policy");
      expect(names).toContain("get_lifecycle_snapshot");
      expect(names).toContain("verify_event_chain");
      expect(names).not.toContain("create_reasoning_policy");

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      expect(JSON.parse(capabilities.contents[0]?.text ?? "{}")).toMatchObject({
        mode: "lifecycle-read-only",
        actor: null,
        mutationToolsEnabled: false,
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("uses one configured agent and never exposes human governance tools", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: "postgresql://unused.invalid/t2k",
      allowMutations: true,
      actorId: "agent:mcp-test",
    });
    const client = await connect(runtime);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toContain("create_reasoning_policy");
      for (const operation of T2K_MCP_HUMAN_GOVERNANCE_OPERATIONS) {
        expect(names).not.toContain(operation);
      }
      for (const tool of listed.tools.filter((item) =>
        [
          "create_reasoning_policy",
          "propose_policy_version",
          "create_decision_context",
          "compute_recommendation",
          "open_decision_episode",
          "record_execution_receipt",
          "record_observation",
          "assess_reward",
          "propose_learning_candidate",
        ].includes(item.name)
      )) {
        expect(tool.inputSchema.properties).not.toHaveProperty("actor");
        expect(tool.inputSchema.properties).not.toHaveProperty("actorId");
        expect(tool.inputSchema.properties).not.toHaveProperty("actorType");
      }

      const capabilities = await client.readResource({
        uri: "t2k://capabilities",
      });
      const body = JSON.parse(capabilities.contents[0]?.text ?? "{}") as {
        actor?: unknown;
      };
      expect(body.actor).toEqual({
        actorType: "agent",
        actorId: "agent:mcp-test",
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});

const databaseUrl = process.env.T2K_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;

describePostgres("T2K MCP Postgres mode", () => {
  it("migrates, mutates with the fixed agent, and reads verifiable state", async () => {
    const runtime = await createT2kMcpRuntime({
      connectionString: databaseUrl,
      autoMigrate: true,
      allowMutations: true,
      actorId: "agent:mcp-integration",
    });
    const client = await connect(runtime);
    const suffix = randomUUID();

    try {
      const created = await client.callTool({
        name: "create_reasoning_policy",
        arguments: {
          policyKey: `mcp-policy-${suffix}`,
          label: "MCP integration policy",
          decisionType: `mcp.decision.${suffix}`,
          actorType: "human",
          actorId: "human:forged-reviewer",
        },
      });
      expect(created.isError).not.toBe(true);
      expect(structuredResult(created)).toMatchObject({
        policyKey: `mcp-policy-${suffix}`,
        createdByActorType: "agent",
        createdByActorId: "agent:mcp-integration",
      });

      const snapshot = await client.callTool({
        name: "get_lifecycle_snapshot",
        arguments: {},
      });
      expect(structuredResult(snapshot)).toMatchObject({
        schemaVersion: 1,
        eventChain: { valid: true },
      });

      const chain = await client.callTool({
        name: "verify_event_chain",
        arguments: {},
      });
      expect(structuredResult(chain)).toMatchObject({ valid: true });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});

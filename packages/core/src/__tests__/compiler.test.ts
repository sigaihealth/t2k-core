import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  compileOntologyPackSet,
  satisfiesOntologyVersionRange,
  semanticHash,
} from "../compiler.js";
import {
  parseOntologyPackManifest,
  validateOntologyPackManifest,
} from "../manifest.js";

function manifest(input: {
  ontologyId: string;
  ontologyVersion?: string;
  extends?: Array<{ ontologyId: string; version: string; required: boolean }>;
  contextDimensions?: Array<{
    id: string;
    description: string;
    requirement: string;
    allowedValues: string[];
    sourceRequired: boolean;
  }>;
}) {
  return {
    manifestType: "t2k.ontology-pack",
    manifestVersion: "1.0",
    ontologyVersion: input.ontologyVersion ?? "1.0.0",
    ontologyId: input.ontologyId,
    label: input.ontologyId,
    description: "Test ontology pack",
    packKind: "vertical",
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
    extends: input.extends ?? [],
    contextDimensions: input.contextDimensions ?? [],
    objectTypes: [
      {
        id: "business",
        label: "Business",
        family: "Operating entity",
        nodeKind: "operating-entity",
        identity: ["legal-name"],
        purpose: "Represents a business",
        properties: [
          {
            id: "legal-name",
            valueType: "string",
            required: true,
            description: "Legal name",
            authorityDomain: "identity",
            temporal: false,
          },
        ],
      },
    ],
  };
}

describe("ontology manifest", () => {
  it("normalizes optional collections and learning contracts", () => {
    const parsed = parseOntologyPackManifest(manifest({ ontologyId: "smb" }));

    expect(parsed?.ontologyId).toBe("smb");
    expect(parsed?.decisionTemplates).toEqual([]);
    expect(parsed?.objectTypes[0]?.nodeKind).toBe("operating-entity");
  });

  it("rejects malformed current manifests", () => {
    expect(parseOntologyPackManifest({ manifestType: "t2k.ontology-pack" })).toBeNull();
  });

  it("executes the published schema instead of coercing invalid semantics", () => {
    const invalid = {
      ...manifest({ ontologyId: "smb" }),
      status: "approved",
      objectTypes: [
        {
          ...manifest({ ontologyId: "smb" }).objectTypes[0],
          unexpectedMeaning: true,
        },
      ],
    };

    const validation = validateOntologyPackManifest(invalid);

    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(["/status", "/objectTypes/0"])
    );
    expect(parseOntologyPackManifest(invalid)).toBeNull();
    expect(
      parseOntologyPackManifest(invalid, { allowLegacyT2kSchema: true })
    ).toMatchObject({ ontologyId: "smb", status: "approved" });
  });
});

describe("pack compiler", () => {
  it("resolves dependency order and produces deterministic hashes", () => {
    const core = manifest({ ontologyId: "core", ontologyVersion: "1.2.0" });
    const smb = manifest({
      ontologyId: "smb",
      extends: [{ ontologyId: "core", version: "^1.0.0", required: true }],
    });
    const input = {
      manifests: [smb, core],
      roots: [{ ontologyId: "smb", version: "1.0.0" }],
    };

    const first = compileOntologyPackSet(input);
    const second = compileOntologyPackSet(input);

    expect(first.status).toBe("valid");
    expect(first.packs.map((pack) => pack.ontologyId)).toEqual(["core", "smb"]);
    expect(first.resolutionHash).toBe(second.resolutionHash);
    expect(first.definitions.length).toBeGreaterThan(2);
  });

  it("canonicalizes equivalent manifest and root ordering", () => {
    const alpha = manifest({ ontologyId: "alpha" });
    const beta = manifest({ ontologyId: "beta" });
    const first = compileOntologyPackSet({
      manifests: [alpha, beta],
      roots: [
        { ontologyId: "beta", version: "1.0.0" },
        { ontologyId: "alpha", version: "1.0.0" },
      ],
    });
    const second = compileOntologyPackSet({
      manifests: [beta, alpha],
      roots: [
        { ontologyId: "alpha", version: "1.0.0" },
        { ontologyId: "beta", version: "1.0.0" },
      ],
    });

    expect(first.resolutionHash).toBe(second.resolutionHash);
    expect(first.packs).toEqual(second.packs);
    expect(first.roots).toEqual(second.roots);
  });

  it("grandfathers only explicitly marked persisted manifests", () => {
    const legacy = {
      ...manifest({ ontologyId: "legacy" }),
      status: "approved",
    };
    const strict = compileOntologyPackSet({
      manifests: [legacy],
      roots: [{ ontologyId: "legacy", version: "1.0.0" }],
    });
    const grandfathered = compileOntologyPackSet({
      manifests: [legacy],
      legacyManifestIndexes: [0],
      roots: [{ ontologyId: "legacy", version: "1.0.0" }],
    });

    expect(strict.status).toBe("invalid");
    expect(grandfathered.status).toBe("valid");
  });

  it("fails closed when required context is absent", () => {
    const result = compileOntologyPackSet({
      manifests: [
        manifest({
          ontologyId: "smb",
          contextDimensions: [
            {
              id: "jurisdiction",
              description: "Operating jurisdiction",
              requirement: "required",
              allowedValues: ["US-CA"],
              sourceRequired: true,
            },
          ],
        }),
      ],
      roots: [{ ontologyId: "smb", version: "1.0.0" }],
    });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "missing_required_context"
    );
  });

  it("keeps specialized object types substitutable with their parents", () => {
    const base = manifest({ ontologyId: "smb" });
    const result = compileOntologyPackSet({
      manifests: [
        {
          ...base,
          objectTypes: [
            ...base.objectTypes,
            {
              id: "branch",
              label: "Branch",
              family: "Operating entity",
              nodeKind: "operating-entity",
              identity: ["branch-id"],
              purpose: "A specialized business branch.",
              specializes: "business",
              properties: [
                {
                  ...base.objectTypes[0].properties[0],
                  valueType: "number",
                  required: false,
                },
              ],
            },
          ],
        },
      ],
      roots: [{ ontologyId: "smb", version: "1.0.0" }],
    });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "incompatible_property_override",
        "weakened_required_property",
      ])
    );
  });
});

describe("semantic utilities", () => {
  it("canonicalizes object key order", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ "ä": 2, z: 1 })).toBe('{"z":1,"ä":2}');
    expect(semanticHash({ b: 2, a: 1 })).toBe(semanticHash({ a: 1, b: 2 }));
  });

  it("supports exact, comparator, tilde, and caret ranges", () => {
    expect(satisfiesOntologyVersionRange("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesOntologyVersionRange("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesOntologyVersionRange("1.4.2", "~1.4.0")).toBe(true);
    expect(satisfiesOntologyVersionRange("1.4.2", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesOntologyVersionRange("1.4.2-beta.10", "^1.0.0")).toBe(false);
    expect(
      satisfiesOntologyVersionRange("1.4.2-beta.10", ">=1.4.2-beta.2 <1.4.2")
    ).toBe(true);
  });
});

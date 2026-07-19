import { createHash } from "node:crypto";

import type { JsonObject, JsonValue } from "./types.js";
import {
  parseOntologyPackManifest,
  type OntologyPackManifest,
} from "./manifest.js";

export type PackCompilerDiagnosticLevel = "error" | "warning" | "review";

export interface PackCompilerDiagnostic {
  level: PackCompilerDiagnosticLevel;
  code: string;
  message: string;
  ontologyId?: string;
  path?: string;
}

export interface OntologyPackRequirement {
  ontologyId: string;
  version: string;
}

export interface CompiledOntologyDefinition {
  definitionKey: string;
  definitionKind:
    | "object_type"
    | "property"
    | "structural_relationship"
    | "canonical_link"
    | "context_dimension"
    | "source_mapping"
    | "authority_rule"
    | "event_type"
    | "reasoning_function"
    | "decision_template"
    | "normalization_rule"
    | "validation_rule"
    | "semantic_question";
  ontologyId: string;
  ontologyVersion: string;
  localId: string;
  inherited: boolean;
  body: JsonObject;
  contentHash: string;
}

export interface CompiledOntologyPack {
  ontologyId: string;
  ontologyVersion: string;
  manifestVersion: string;
  label: string;
  packKind: string;
  status: string;
  isRoot: boolean;
  dependencyOrder: number;
  contentHash: string;
}

export interface CompiledOntologyPackSet {
  status: "valid" | "invalid";
  resolutionHash: string;
  roots: OntologyPackRequirement[];
  packs: CompiledOntologyPack[];
  definitions: CompiledOntologyDefinition[];
  contextRequirements: Array<{
    id: string;
    ontologyId: string;
    requirement: string;
    sourceRequired: boolean;
    allowedValues: string[];
    description: string;
  }>;
  diagnostics: PackCompilerDiagnostic[];
}

export interface CompileOntologyPackSetInput {
  manifests: unknown[];
  roots: OntologyPackRequirement[];
  contextValues?: Record<string, unknown>;
  /** Indexes of persisted manifests accepted before strict schema validation. */
  legacyManifestIndexes?: number[];
}

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function compareCanonicalStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, item]) => [key, stableJsonValue(item)])
    );
  }

  return String(value);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}

export function semanticHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(
    value.trim()
  );

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ?? null,
  };
}

function compareSemanticVersions(left: string, right: string) {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);

  if (!parsedLeft || !parsedRight) {
    return compareCanonicalStrings(left, right);
  }

  return compareParsedVersion(parsedLeft, parsedRight);
}

function comparePrereleaseIdentifiers(left: string, right: string) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");

  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) {
      return Number(leftPart) - Number(rightPart);
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return compareCanonicalStrings(leftPart, rightPart);
  }

  return 0;
}

function compareParsedVersion(
  left: SemanticVersion,
  right: SemanticVersion
) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }
  if (left.prerelease === right.prerelease) {
    return 0;
  }
  if (left.prerelease === null) {
    return 1;
  }
  if (right.prerelease === null) {
    return -1;
  }
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease);
}

function rangeIncludesPrereleaseForVersion(
  range: string,
  version: SemanticVersion
) {
  const candidates =
    range.match(/\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/g) ?? [];

  return candidates.some((candidate) => {
    const parsed = parseSemanticVersion(candidate);
    return Boolean(
      parsed?.prerelease &&
        parsed.major === version.major &&
        parsed.minor === version.minor &&
        parsed.patch === version.patch
    );
  });
}

function testComparator(version: SemanticVersion, comparator: string) {
  const match = /^(>=|<=|>|<|=)?\s*(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)$/.exec(
    comparator.trim()
  );

  if (!match) {
    return false;
  }

  const target = parseSemanticVersion(match[2] ?? "");

  if (!target) {
    return false;
  }

  const comparison = compareParsedVersion(version, target);

  switch (match[1] ?? "=") {
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    default:
      return comparison === 0;
  }
}

export function satisfiesOntologyVersionRange(
  versionValue: string,
  rangeValue: string
) {
  const version = parseSemanticVersion(versionValue);
  const range = rangeValue.trim();

  if (!version) {
    return false;
  }

  // Stable ranges do not select prerelease packs implicitly.
  if (version.prerelease && !rangeIncludesPrereleaseForVersion(range, version)) {
    return false;
  }

  if (!range || range === "*" || range.toLowerCase() === "latest") {
    return true;
  }

  if (range.startsWith("^")) {
    const minimum = parseSemanticVersion(range.slice(1));

    if (!minimum || compareParsedVersion(version, minimum) < 0) {
      return false;
    }

    if (minimum.major > 0) {
      return version.major === minimum.major;
    }

    if (minimum.minor > 0) {
      return version.major === 0 && version.minor === minimum.minor;
    }

    return (
      version.major === 0 &&
      version.minor === 0 &&
      version.patch === minimum.patch
    );
  }

  if (range.startsWith("~")) {
    const minimum = parseSemanticVersion(range.slice(1));

    return Boolean(
      minimum &&
        compareParsedVersion(version, minimum) >= 0 &&
        version.major === minimum.major &&
        version.minor === minimum.minor
    );
  }

  if (/^(?:>=|<=|>|<|=)/.test(range)) {
    return range
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => testComparator(version, comparator));
  }

  return testComparator(version, range);
}

function manifestIdentity(manifest: OntologyPackManifest) {
  return `${manifest.ontologyId}@${manifest.ontologyVersion}`;
}

function localObjectReference(ontologyId: string, objectId: string) {
  return `${ontologyId}:${objectId}`;
}

function resolveObjectReference(
  ontologyId: string,
  reference: string,
  objectDefinitions: Map<string, CompiledOntologyDefinition>
) {
  const localReference = localObjectReference(ontologyId, reference);

  if (objectDefinitions.has(localReference)) {
    return localReference;
  }

  return objectDefinitions.has(reference) ? reference : null;
}

function addDiagnostic(
  diagnostics: PackCompilerDiagnostic[],
  diagnostic: PackCompilerDiagnostic
) {
  if (
    !diagnostics.some(
      (existing) =>
        existing.code === diagnostic.code &&
        existing.message === diagnostic.message &&
        existing.ontologyId === diagnostic.ontologyId &&
        existing.path === diagnostic.path
    )
  ) {
    diagnostics.push(diagnostic);
  }
}

function asJsonObject(value: unknown): JsonObject {
  const normalized = stableJsonValue(value);
  return normalized && !Array.isArray(normalized) && typeof normalized === "object"
    ? normalized
    : { value: normalized };
}

function definition(
  input: Omit<CompiledOntologyDefinition, "contentHash">
): CompiledOntologyDefinition {
  return {
    ...input,
    contentHash: semanticHash(input.body),
  };
}

function buildDefinitions(
  manifests: OntologyPackManifest[],
  rootIdentities: Set<string>,
  diagnostics: PackCompilerDiagnostic[]
) {
  const definitions: CompiledOntologyDefinition[] = [];
  const objectDefinitions = new Map<string, CompiledOntologyDefinition>();
  const objectTypes = new Map<
    string,
    OntologyPackManifest["objectTypes"][number]
  >();

  for (const manifest of manifests) {
    const seenLocalObjectIds = new Set<string>();

    for (const objectType of manifest.objectTypes) {
      const objectReference = localObjectReference(
        manifest.ontologyId,
        objectType.id
      );

      if (seenLocalObjectIds.has(objectType.id)) {
        addDiagnostic(diagnostics, {
          level: "error",
          code: "duplicate_object_type",
          ontologyId: manifest.ontologyId,
          path: `objectTypes.${objectType.id}`,
          message: `Object type ${objectType.id} is declared more than once.`,
        });
        continue;
      }

      seenLocalObjectIds.add(objectType.id);
      const compiled = definition({
        definitionKey: objectReference,
        definitionKind: "object_type",
        ontologyId: manifest.ontologyId,
        ontologyVersion: manifest.ontologyVersion,
        localId: objectType.id,
        inherited: !rootIdentities.has(manifestIdentity(manifest)),
        body: asJsonObject(objectType),
      });
      objectDefinitions.set(objectReference, compiled);
      objectTypes.set(objectReference, objectType);
      definitions.push(compiled);

      const seenPropertyIds = new Set<string>();
      for (const property of objectType.properties) {
        if (seenPropertyIds.has(property.id)) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "duplicate_property",
            ontologyId: manifest.ontologyId,
            path: `objectTypes.${objectType.id}.properties.${property.id}`,
            message: `Property ${objectType.id}.${property.id} is declared more than once.`,
          });
          continue;
        }

        seenPropertyIds.add(property.id);
        definitions.push(
          definition({
            definitionKey: `${objectReference}.${property.id}`,
            definitionKind: "property",
            ontologyId: manifest.ontologyId,
            ontologyVersion: manifest.ontologyVersion,
            localId: `${objectType.id}.${property.id}`,
            inherited: !rootIdentities.has(manifestIdentity(manifest)),
            body: asJsonObject({ objectType: objectReference, ...property }),
          })
        );
      }
    }
  }

  const specializationEdges = new Map<string, string>();

  for (const manifest of manifests) {
    const inherited = !rootIdentities.has(manifestIdentity(manifest));

    for (const objectType of manifest.objectTypes) {
      const objectReference = localObjectReference(
        manifest.ontologyId,
        objectType.id
      );

      if (objectType.specializes) {
        const target = resolveObjectReference(
          manifest.ontologyId,
          objectType.specializes,
          objectDefinitions
        );

        if (!target) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "unknown_specialization_target",
            ontologyId: manifest.ontologyId,
            path: `objectTypes.${objectType.id}.specializes`,
            message: `${objectReference} specializes unknown object type ${objectType.specializes}.`,
          });
        } else {
          specializationEdges.set(objectReference, target);
        }
      }

      if (objectType.replaces) {
        const target = resolveObjectReference(
          manifest.ontologyId,
          objectType.replaces,
          objectDefinitions
        );

        if (!target) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "unknown_replacement_target",
            ontologyId: manifest.ontologyId,
            path: `objectTypes.${objectType.id}.replaces`,
            message: `${objectReference} replaces unknown object type ${objectType.replaces}.`,
          });
        }

        if (!objectType.compatibilityNote) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "missing_compatibility_note",
            ontologyId: manifest.ontologyId,
            path: `objectTypes.${objectType.id}.compatibilityNote`,
            message: `${objectReference} declares a replacement without migration guidance.`,
          });
        }
      }
    }

    manifest.structuralRelationships.forEach((relationship, index) => {
      const source = resolveObjectReference(
        manifest.ontologyId,
        relationship.from,
        objectDefinitions
      );
      const target = resolveObjectReference(
        manifest.ontologyId,
        relationship.to,
        objectDefinitions
      );

      if (!source || !target) {
        addDiagnostic(diagnostics, {
          level: "error",
          code: "dangling_structural_relationship",
          ontologyId: manifest.ontologyId,
          path: `structuralRelationships.${index}`,
          message: `${relationship.from}.${relationship.property} references an unknown source or target object type.`,
        });
        return;
      }

      definitions.push(
        definition({
          definitionKey: `${manifest.ontologyId}:relation:${relationship.from}:${relationship.property}:${relationship.to}`,
          definitionKind: "structural_relationship",
          ontologyId: manifest.ontologyId,
          ontologyVersion: manifest.ontologyVersion,
          localId: `${relationship.from}.${relationship.property}`,
          inherited,
          body: asJsonObject({ ...relationship, from: source, to: target }),
        })
      );
    });

    const addCollection = <T extends object>(
      kind: CompiledOntologyDefinition["definitionKind"],
      values: T[],
      idFor: (value: T, index: number) => string
    ) => {
      values.forEach((value, index) => {
        const localId = idFor(value, index);
        definitions.push(
          definition({
            definitionKey: `${manifest.ontologyId}:${kind}:${localId}`,
            definitionKind: kind,
            ontologyId: manifest.ontologyId,
            ontologyVersion: manifest.ontologyVersion,
            localId,
            inherited,
            body: asJsonObject(value),
          })
        );
      });
    };

    addCollection(
      "canonical_link",
      manifest.canonicalLinks,
      (value) => String(value.link)
    );
    addCollection(
      "context_dimension",
      manifest.contextDimensions,
      (value) => String(value.id)
    );
    addCollection(
      "source_mapping",
      manifest.sourceMappings,
      (value) => String(value.id)
    );
    addCollection(
      "authority_rule",
      manifest.authorityModel,
      (value) => String(value.domain)
    );
    addCollection("event_type", manifest.eventTypes, (value) => String(value.id));
    addCollection(
      "reasoning_function",
      manifest.reasoningFunctions,
      (value) => String(value.id)
    );
    addCollection(
      "decision_template",
      manifest.decisionTemplates,
      (value) => String(value.id)
    );
    addCollection(
      "normalization_rule",
      manifest.normalizationRules.map((rule) => ({ rule })),
      (_value, index) => String(index + 1)
    );
    addCollection(
      "validation_rule",
      manifest.validationRules,
      (value) => String(value.id)
    );
    addCollection(
      "semantic_question",
      manifest.openSemanticQuestions,
      (value) => String(value.id)
    );
  }

  for (const start of specializationEdges.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = start;

    while (current) {
      if (visited.has(current)) {
        addDiagnostic(diagnostics, {
          level: "error",
          code: "specialization_cycle",
          path: current,
          message: `Object specialization cycle detected at ${current}.`,
        });
        break;
      }

      visited.add(current);
      current = specializationEdges.get(current);
    }
  }

  for (const [childReference, parentReference] of specializationEdges) {
    const child = objectTypes.get(childReference);
    const childDefinition = objectDefinitions.get(childReference);
    if (!child || !childDefinition) continue;

    const lineageVisited = new Set([childReference]);
    let currentParent: string | undefined = parentReference;
    while (currentParent && !lineageVisited.has(currentParent)) {
      lineageVisited.add(currentParent);
      const parent = objectTypes.get(currentParent);
      if (!parent) break;
      for (const childProperty of child.properties) {
        const inheritedProperty = parent.properties.find(
          (property) => property.id === childProperty.id
        );
        if (!inheritedProperty) continue;
        if (childProperty.valueType !== inheritedProperty.valueType) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "incompatible_property_override",
            ontologyId: childDefinition.ontologyId,
            path: `objectTypes.${child.id}.properties.${childProperty.id}`,
            message: `${childReference} changes inherited property ${childProperty.id} from ${inheritedProperty.valueType} to ${childProperty.valueType}, which breaks substitutability with ${currentParent}.`,
          });
        }
        if (inheritedProperty.required && !childProperty.required) {
          addDiagnostic(diagnostics, {
            level: "error",
            code: "weakened_required_property",
            ontologyId: childDefinition.ontologyId,
            path: `objectTypes.${child.id}.properties.${childProperty.id}.required`,
            message: `${childReference} cannot make inherited required property ${childProperty.id} optional.`,
          });
        }
      }
      currentParent = specializationEdges.get(currentParent);
    }
  }

  const duplicateDefinitionKeys = new Set<string>();
  const seenDefinitionKeys = new Set<string>();

  for (const item of definitions) {
    if (seenDefinitionKeys.has(item.definitionKey)) {
      duplicateDefinitionKeys.add(item.definitionKey);
    }
    seenDefinitionKeys.add(item.definitionKey);
  }

  for (const duplicateKey of duplicateDefinitionKeys) {
    addDiagnostic(diagnostics, {
      level: "error",
      code: "duplicate_definition",
      path: duplicateKey,
      message: `Compiled definition key ${duplicateKey} is not unique.`,
    });
  }

  return definitions;
}

function contextValueState(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const state = (value as Record<string, unknown>).state;
    return typeof state === "string" ? state : "known";
  }

  return value === undefined ? "missing" : "known";
}

function contextValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return Object.hasOwn(record, "value") ? record.value : value;
  }

  return value;
}

function validateContextRequirements(
  manifests: OntologyPackManifest[],
  contextValues: Record<string, unknown>,
  diagnostics: PackCompilerDiagnostic[]
) {
  const requirements = manifests.flatMap((manifest) =>
    manifest.contextDimensions.map((dimension) => ({
      ...dimension,
      ontologyId: manifest.ontologyId,
    }))
  );
  const byDimensionId = new Map<string, (typeof requirements)[number]>();

  for (const requirement of requirements) {
    const existing = byDimensionId.get(requirement.id);

    if (existing && canonicalJson(existing) !== canonicalJson(requirement)) {
      addDiagnostic(diagnostics, {
        level: "review",
        code: "context_requirement_conflict",
        ontologyId: requirement.ontologyId,
        path: `contextDimensions.${requirement.id}`,
        message: `Context dimension ${requirement.id} has incompatible requirements across packs.`,
      });
    } else if (!existing) {
      byDimensionId.set(requirement.id, requirement);
    }

    const supplied =
      contextValues[`${requirement.ontologyId}:${requirement.id}`] ??
      contextValues[requirement.id];
    const suppliedState = contextValueState(supplied);
    const suppliedValue = contextValue(supplied);

    if (
      requirement.requirement === "required" &&
      (suppliedState === "missing" || suppliedState === "unknown")
    ) {
      addDiagnostic(diagnostics, {
        level: "error",
        code: "missing_required_context",
        ontologyId: requirement.ontologyId,
        path: `contextDimensions.${requirement.id}`,
        message: `Required context dimension ${requirement.id} has no reviewed value.`,
      });
    }

    if (
      requirement.allowedValues.length > 0 &&
      suppliedState === "known" &&
      typeof suppliedValue === "string" &&
      !requirement.allowedValues.includes(suppliedValue)
    ) {
      addDiagnostic(diagnostics, {
        level: "error",
        code: "invalid_context_value",
        ontologyId: requirement.ontologyId,
        path: `contextDimensions.${requirement.id}`,
        message: `${suppliedValue} is not allowed for context dimension ${requirement.id}.`,
      });
    }

    if (requirement.sourceRequired && suppliedState === "known") {
      const sourceRefs =
        supplied && typeof supplied === "object" && !Array.isArray(supplied)
          ? (supplied as Record<string, unknown>).sourceRefs
          : null;

      if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
        addDiagnostic(diagnostics, {
          level: "error",
          code: "missing_context_source",
          ontologyId: requirement.ontologyId,
          path: `contextDimensions.${requirement.id}.sourceRefs`,
          message: `Context dimension ${requirement.id} requires a source reference.`,
        });
      }
    }
  }

  return requirements;
}

export function compileOntologyPackSet(
  input: CompileOntologyPackSetInput
): CompiledOntologyPackSet {
  const diagnostics: PackCompilerDiagnostic[] = [];
  const parsedManifests: OntologyPackManifest[] = [];
  const identities = new Set<string>();
  const legacyManifestIndexes = new Set(input.legacyManifestIndexes ?? []);
  const roots = Array.from(
    new Map(
      input.roots.map((root) => [
        `${root.ontologyId}\u0000${root.version}`,
        { ontologyId: root.ontologyId, version: root.version },
      ])
    ).values()
  ).sort(
    (left, right) =>
      compareCanonicalStrings(left.ontologyId, right.ontologyId) ||
      compareCanonicalStrings(left.version, right.version)
  );

  input.manifests.forEach((rawManifest, index) => {
    const manifest = parseOntologyPackManifest(rawManifest, {
      allowLegacyT2kSchema: legacyManifestIndexes.has(index),
    });

    if (!manifest) {
      addDiagnostic(diagnostics, {
        level: "error",
        code: "invalid_manifest",
        path: `manifests.${index}`,
        message: `Manifest ${index + 1} does not satisfy the T2K ontology-pack contract.`,
      });
      return;
    }

    const identity = manifestIdentity(manifest);
    if (identities.has(identity)) {
      addDiagnostic(diagnostics, {
        level: "error",
        code: "duplicate_pack_version",
        ontologyId: manifest.ontologyId,
        path: identity,
        message: `Pack version ${identity} is supplied more than once.`,
      });
      return;
    }

    identities.add(identity);
    parsedManifests.push(manifest);
  });

  if (roots.length === 0) {
    addDiagnostic(diagnostics, {
      level: "error",
      code: "missing_roots",
      message: "At least one root ontology pack is required.",
    });
  }

  const catalog = new Map<string, OntologyPackManifest[]>();
  for (const manifest of parsedManifests) {
    catalog.set(
      manifest.ontologyId,
      [...(catalog.get(manifest.ontologyId) ?? []), manifest].sort((left, right) =>
        compareSemanticVersions(right.ontologyVersion, left.ontologyVersion)
      )
    );
  }

  const chooseManifest = (requirement: OntologyPackRequirement) => {
    const candidates = catalog.get(requirement.ontologyId) ?? [];
    return (
      candidates.find((candidate) =>
        satisfiesOntologyVersionRange(candidate.ontologyVersion, requirement.version)
      ) ?? null
    );
  };

  const ordered: OntologyPackManifest[] = [];
  const visited = new Set<string>();
  const visiting: string[] = [];

  const visit = (
    requirement: OntologyPackRequirement,
    requiredBy: string | null,
    required = true
  ) => {
    const manifest = chooseManifest(requirement);

    if (!manifest) {
      addDiagnostic(diagnostics, {
        level: required ? "error" : "warning",
        code: required ? "missing_dependency" : "missing_optional_dependency",
        ontologyId: requirement.ontologyId,
        message: `${requiredBy ?? "Root resolution"} requires ${requirement.ontologyId} at ${requirement.version}, but no compatible version is available.`,
      });
      return;
    }

    const identity = manifestIdentity(manifest);
    const cycleIndex = visiting.indexOf(identity);

    if (cycleIndex >= 0) {
      addDiagnostic(diagnostics, {
        level: "error",
        code: "dependency_cycle",
        ontologyId: manifest.ontologyId,
        message: `Ontology dependency cycle: ${[
          ...visiting.slice(cycleIndex),
          identity,
        ].join(" -> ")}.`,
      });
      return;
    }

    if (visited.has(identity)) {
      return;
    }

    visiting.push(identity);
    [...manifest.extends]
      .sort(
        (left, right) =>
          compareCanonicalStrings(left.ontologyId, right.ontologyId) ||
          compareCanonicalStrings(left.version, right.version) ||
          Number(right.required) - Number(left.required)
      )
      .forEach((dependency) =>
        visit(
          { ontologyId: dependency.ontologyId, version: dependency.version },
          identity,
          dependency.required
        )
      );
    visiting.pop();
    visited.add(identity);
    ordered.push(manifest);
  };

  roots.forEach((root) => visit(root, null));

  const rootIdentities = new Set(
    roots
      .map(chooseManifest)
      .filter((manifest): manifest is OntologyPackManifest => Boolean(manifest))
      .map(manifestIdentity)
  );
  const contextRequirements = validateContextRequirements(
    ordered,
    input.contextValues ?? {},
    diagnostics
  );
  const definitions = buildDefinitions(ordered, rootIdentities, diagnostics);
  const packs = ordered.map((manifest, dependencyOrder) => ({
    ontologyId: manifest.ontologyId,
    ontologyVersion: manifest.ontologyVersion,
    manifestVersion: manifest.manifestVersion,
    label: manifest.label,
    packKind: manifest.packKind,
    status: manifest.status,
    isRoot: rootIdentities.has(manifestIdentity(manifest)),
    dependencyOrder,
    contentHash: semanticHash(manifest),
  }));

  for (const pack of packs) {
    if (pack.status === "deprecated") {
      addDiagnostic(diagnostics, {
        level: "warning",
        code: "deprecated_pack",
        ontologyId: pack.ontologyId,
        message: `${pack.ontologyId}@${pack.ontologyVersion} is deprecated.`,
      });
    }
  }

  const resolutionPayload = {
    roots,
    packs: packs.map(({ ontologyId, ontologyVersion, contentHash }) => ({
      ontologyId,
      ontologyVersion,
      contentHash,
    })),
    definitions: definitions.map(({ definitionKey, contentHash }) => ({
      definitionKey,
      contentHash,
    })),
    contextValues: input.contextValues ?? {},
  };

  return {
    status: diagnostics.some((item) => item.level === "error")
      ? "invalid"
      : "valid",
    resolutionHash: semanticHash(resolutionPayload),
    roots,
    packs,
    definitions,
    contextRequirements,
    diagnostics,
  };
}

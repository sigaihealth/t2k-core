# Governance

T2K Core is maintainer-led with an open proposal and review process. The goal is
to keep the standard small, deterministic, interoperable, and implementable by
more than one system.

## Roles

- Contributors propose issues, pull requests, fixtures, and implementations.
- Reviewers provide technical review but do not merge by role alone.
- Maintainers triage, merge, release, and make compatibility decisions.

The initial maintainer is `@sigaihealth`. Maintainers may appoint additional
maintainers after sustained, technically sound contributions and demonstrated
care for backward compatibility.

## Decision Process

Routine implementation changes require one maintainer approval and green CI.
Normative specification changes require:

1. a public issue describing the problem and alternatives;
2. a compatibility and migration analysis;
3. executable conformance changes;
4. at least two maintainer reviews once two maintainers exist;
5. a documented resolution in the issue and changelog.

Maintainers seek consensus. If consensus is not possible, the lead maintainer
makes and documents the decision. Governance changes use the same process as
normative specification changes.

## Compatibility

- Patch releases clarify text or fix implementation defects without changing a
  valid manifest's meaning.
- Minor releases add optional, backward-compatible vocabulary or behavior.
- Major releases may remove or reinterpret fields and require migration notes.
- Tightening validation that rejects previously valid standard manifests is a
  compatibility change, not an editorial fix.

The published JSON Schema and conformance fixtures are normative. A reference
implementation that disagrees with them is a bug.

## Releases

Releases are produced only from protected `main` commits with green CI. Package
tags are signed when maintainer tooling supports it. npm publication uses
provenance and must match the public repository commit and package version.

## Project Boundary

This governance covers the open standard and portable packages in this
repository. It does not govern hosted Studio operations, private registries,
customer knowledge, or commercial support services.

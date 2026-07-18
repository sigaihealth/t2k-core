# Contributing

T2K Core accepts focused changes to the standard, conformance suite, portable
runtime, and fully synthetic examples.

## Before Opening a Change

1. Search existing issues and discussions.
2. Open an issue before changing a normative schema or compatibility rule.
3. Keep private business data, credentials, deployment topology, and
   customer-derived vocabulary out of issues, fixtures, and commits.
4. Use synthetic organizations, people, facts, and source locators in tests.

## Development

```bash
npm ci
npm run check
```

`npm run check` runs the scrub guard, typecheck, unit tests, conformance suite,
synthetic example, dependency audit, package dry-run, and clean-install smoke
test. A change is not complete until the command passes from a clean checkout.

## Commit Sign-Off

This project uses the [Developer Certificate of Origin](DCO.md), not a
Contributor License Agreement. Sign every commit:

```bash
git commit -s -m "feat: describe the change"
```

The sign-off certifies only that you have the right to contribute the work. It
does not transfer copyright to the project.

## Specification Changes

Normative changes must include:

- the proposed compatibility classification;
- updated schema and versioned prose when applicable;
- positive and negative conformance fixtures;
- migration guidance for breaking or tightening changes;
- a changelog entry.

Minor editorial corrections may use a normal pull request. Maintainers decide
whether a proposal requires a new schema minor or major version under
[GOVERNANCE.md](GOVERNANCE.md).

## Pull Requests

- Keep a pull request scoped to one coherent change.
- Explain observable behavior and compatibility impact.
- Add tests for fixes and new behavior.
- Do not commit generated `dist`, tarballs, credentials, or environment files.
- Expect review to prioritize semantic compatibility and reproducibility over
  convenience coercions.

Maintainer release procedure: [docs/RELEASING.md](docs/RELEASING.md).

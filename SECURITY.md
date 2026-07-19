# Security Policy

## Supported Versions

Security fixes are applied to the latest minor release. The repository is in a
developer-preview phase; users should pin exact package versions and review the
changelog before upgrading.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/sigaihealth/t2k-core/security/advisories/new)
with:

- affected version and component;
- reproduction steps or proof of concept;
- expected impact;
- any known mitigations;
- a safe way to contact you.

The maintainers will acknowledge a complete report within five business days,
coordinate validation and remediation, and credit reporters who want public
recognition. Please allow a reasonable remediation window before disclosure.

## Scope

Reports about schema validation bypasses, unsafe policy paths, dependency
resolution ambiguity, semantic-hash inconsistencies, client credential leakage,
package supply-chain integrity, MCP actor-identity override, MCP mode escalation,
or exposure of human-only lifecycle transitions are in scope.

`@t2kai/mcp` is read-only by default. Its optional mutation mode must use a
fixed server-configured agent identity and deliberately omits every operation
that asserts human approval, authorization, closure, evaluation, promotion,
deployment, or rollback. Treat any path that lets tool input override that
identity or invoke those transitions as a security vulnerability.

The hosted T2K service has a separate operational security boundary. Include
the affected URL in your report so it can be routed correctly.

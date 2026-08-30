import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { request as httpRequest } from "node:http";

import { createDemoServer } from "../server.mjs";

function rawRequest(url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
}

describe("integration hub demo server", () => {
  let baseUrl;
  let model;
  let server;

  before(async () => {
    server = await createDemoServer({
      clock: () => new Date("2026-08-30T12:00:00.000Z"),
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;
    model = await (await fetch(`${baseUrl}/api/demo`)).json();
  });

  after(async () => {
    if (!server) return;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("serves the accessible app and health endpoint with security headers", async () => {
    const page = await fetch(baseUrl);
    const html = await page.text();
    const health = await (await fetch(`${baseUrl}/health`)).json();

    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(html, /Skip to the demo/);
    assert.match(html, /Record a demo disposition/);
    assert.deepEqual(health, {
      status: "ok",
      ontologyValid: true,
      deterministic: true,
    });
  });

  it("exposes live core output rather than precomputed UI fixtures", () => {
    assert.equal(model.agencies.length, 3);
    assert.equal(model.proposal.status, "needs_review");
    assert.equal(model.entityResolution.decision.status, "needs_review");
    assert.deepEqual(
      model.purposeAccess.checks.map(({ receipt }) => receipt.reasonCode),
      ["explicit_allow", "default_deny"]
    );
    assert.equal(model.reviewLog.count, 0);
  });

  it("rejects AI-authored and stale human-authority claims", async () => {
    const unresolved = model.humanReview.unresolvedFields[0];
    const common = {
      proposalHash: model.proposal.proposalHash,
      entityDecisionHash: model.entityResolution.decision.decisionHash,
      decision: "approve_proposal",
      reviewerRole: "program_case_supervisor",
      reviewer: "Demo Reviewer",
      rationale: "The evidence was independently reviewed.",
      attestation: true,
      selections: {
        [unresolved.propertyRef]: unresolved.candidates[0].valueHash,
      },
      entitySelection:
        model.entityResolution.decision.candidates[0].entityKey,
    };
    const aiResponse = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...common, actorType: "ai_agent" }),
    });
    const staleResponse = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...common,
        actorType: "human",
        proposalHash: "stale-proposal-hash",
      }),
    });

    assert.equal(aiResponse.status, 400);
    assert.match((await aiResponse.json()).error, /Only a human-attested review/);
    assert.equal(staleResponse.status, 409);
    assert.match((await staleResponse.json()).error, /proposal changed/i);
  });

  it("requires every unresolved choice before human approval", async () => {
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalHash: model.proposal.proposalHash,
        entityDecisionHash: model.entityResolution.decision.decisionHash,
        decision: "approve_proposal",
        actorType: "human",
        reviewerRole: "program_case_supervisor",
        reviewer: "Demo Reviewer",
        rationale: "The evidence was independently reviewed.",
        attestation: true,
        selections: {},
      }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Select one candidate/);
  });

  it("rejects bogus field selections on correction returns", async () => {
    const unresolved = model.humanReview.unresolvedFields[0];
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalHash: model.proposal.proposalHash,
        entityDecisionHash: model.entityResolution.decision.decisionHash,
        decision: "return_for_correction",
        actorType: "human",
        reviewerRole: "program_case_supervisor",
        reviewer: "Demo Reviewer",
        rationale: "This source selection needs correction before approval.",
        attestation: true,
        selections: {
          [unresolved.propertyRef]: "bogus-candidate-hash",
        },
      }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /not in this proposal/i);
  });

  it("rejects missing and stale entity decision hashes", async () => {
    const common = {
      proposalHash: model.proposal.proposalHash,
      decision: "return_for_correction",
      actorType: "human",
      reviewerRole: "program_case_supervisor",
      reviewer: "Demo Reviewer",
      rationale: "The evidence needs correction before another review.",
      attestation: true,
      selections: {},
    };
    const missingResponse = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(common),
    });
    const staleResponse = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...common,
        entityDecisionHash: "stale-entity-decision-hash",
      }),
    });

    assert.equal(missingResponse.status, 400);
    assert.match(
      (await missingResponse.json()).error,
      /entity decision hash is required/i
    );
    assert.equal(staleResponse.status, 409);
    assert.match((await staleResponse.json()).error, /entity decision changed/i);
  });

  it("records a complete hash-bound human disposition without activating or merging", async () => {
    const unresolved = model.humanReview.unresolvedFields[0];
    const entitySelection =
      model.entityResolution.decision.candidates[0].entityKey;
    const entityDecisionHash =
      model.entityResolution.decision.decisionHash;
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalHash: model.proposal.proposalHash,
        entityDecisionHash,
        decision: "approve_proposal",
        actorType: "human",
        reviewerRole: "program_case_supervisor",
        reviewer: "Demo Reviewer",
        rationale: "The source receipts support this review packet.",
        attestation: true,
        selections: {
          [unresolved.propertyRef]: unresolved.candidates[0].valueHash,
        },
        entitySelection,
      }),
    });
    const result = await response.json();

    assert.equal(response.status, 201);
    assert.equal(result.record.actorType, "human");
    assert.equal(result.record.storage, "ephemeral_memory");
    assert.equal(result.record.activationStatus, "not_activated");
    assert.equal(result.record.entityLinkStatus, "not_applied");
    assert.equal(result.record.entitySelection, entitySelection);
    assert.equal(result.record.entityDecisionHash, entityDecisionHash);
    assert.equal(result.reviewLog.count, 1);

    const refreshed = await (await fetch(`${baseUrl}/api/demo`)).json();
    assert.equal(refreshed.proposal.proposalHash, model.proposal.proposalHash);
    assert.equal(refreshed.proposal.status, "needs_review");
    assert.equal(refreshed.entityResolution.decision.status, "needs_review");
    assert.equal(refreshed.reviewLog.count, 1);
  });

  it("does not expose arbitrary repository files", async () => {
    const response = await fetch(`${baseUrl}/package.json`);
    assert.equal(response.status, 404);
  });

  it("rejects non-loopback hosts and cross-origin review mutations", async () => {
    const hostileHost = await rawRequest(`${baseUrl}/api/demo`, {
      headers: { Host: "attacker.example" },
    });
    const hostileOrigin = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://attacker.example",
      },
      body: JSON.stringify({
        proposalHash: model.proposal.proposalHash,
        entityDecisionHash: model.entityResolution.decision.decisionHash,
        decision: "return_for_correction",
        actorType: "human",
        reviewerRole: "program_case_supervisor",
        reviewer: "Demo Reviewer",
        rationale: "The evidence needs correction before another review.",
        attestation: true,
        selections: {},
      }),
    });

    assert.equal(hostileHost.status, 403);
    assert.match(JSON.parse(hostileHost.body).error, /loopback Host/i);
    assert.equal(hostileOrigin.status, 403);
    assert.match((await hostileOrigin.json()).error, /origin must match/i);
  });

  it("returns resource-specific Allow headers", async () => {
    const reviewRoute = await fetch(`${baseUrl}/api/reviews`, {
      method: "PUT",
    });
    const pageRoute = await fetch(baseUrl, { method: "POST" });
    const missingRoute = await fetch(`${baseUrl}/missing`, { method: "PUT" });

    assert.equal(reviewRoute.status, 405);
    assert.equal(reviewRoute.headers.get("allow"), "POST");
    assert.equal(pageRoute.status, 405);
    assert.equal(pageRoute.headers.get("allow"), "GET, HEAD");
    assert.equal(missingRoute.status, 404);
  });
});

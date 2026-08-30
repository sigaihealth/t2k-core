import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createDemoServer } from "../server.mjs";

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

  it("records a complete human disposition without activating or merging", async () => {
    const unresolved = model.humanReview.unresolvedFields[0];
    const entitySelection =
      model.entityResolution.decision.candidates[0].entityKey;
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalHash: model.proposal.proposalHash,
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
});

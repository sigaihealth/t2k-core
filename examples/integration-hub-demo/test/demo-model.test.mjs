import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { semanticHash } from "@t2kai/core/compiler";

import { buildDemoModel } from "../src/demo-model.mjs";

function field(model, propertyRef) {
  const result = model.proposal.fields.find(
    (candidate) => candidate.propertyRef === propertyRef
  );
  assert.ok(result, `Expected canonical field ${propertyRef}.`);
  return result;
}

describe("integration hub demo model", () => {
  it("executes three independent source mappings with receipt-bound provenance", async () => {
    const model = await buildDemoModel();

    assert.equal(model.ontology.valid, true);
    assert.equal(model.agencies.length, 3);
    assert.equal(new Set(model.agencies.map((item) => item.sourceSystem)).size, 3);
    assert.ok(
      model.agencies.every(({ receipt }) => receipt.status === "mapped")
    );
    assert.ok(
      model.agencies.every(
        ({ receipt }) => receipt.humanReviewRequired === true
      )
    );
    assert.equal(
      new Set(
        model.agencies.map(({ canonicalRecord }) =>
          semanticHash(canonicalRecord.identity)
        )
      ).size,
      1
    );
    assert.deepEqual(model.proposal.identity, { person_id: "PB-1042" });
    assert.equal(
      model.agencies.find(({ agency }) => agency.id === "state-benefits")
        .payload.clientNumber,
      " pb-1042 "
    );
  });

  it("preserves conflicts and applies authority only inside a proposal", async () => {
    const model = await buildDemoModel();

    assert.equal(model.proposal.status, "needs_review");
    assert.equal(model.proposal.nonMutating, true);
    assert.equal(model.proposal.alternativesPreserved, true);

    assert.deepEqual(
      {
        status: field(model, "display_name").status,
        resolution: field(model, "display_name").resolution,
        selectedValue: field(model, "display_name").selectedValue,
        candidateCount: field(model, "display_name").candidates.length,
      },
      {
        status: "needs_review",
        resolution: "unresolved",
        selectedValue: null,
        candidateCount: 2,
      }
    );
    assert.equal(field(model, "mailing_address").resolution, "preserve_all");
    assert.equal(field(model, "mailing_address").selectedValue, null);
    assert.deepEqual(
      {
        eligibility: field(model, "eligibility_status").selectedValue,
        employment: field(model, "employment_status").selectedValue,
      },
      { eligibility: "eligible", employment: "employed" }
    );
    assert.equal(model.boundary.canonicalActivationImplemented, false);
  });

  it("proves reconciliation is invariant to agency input order", async () => {
    const model = await buildDemoModel();
    const hashes = model.determinism.proposalHashes.map(
      ({ proposalHash }) => proposalHash
    );

    assert.equal(model.determinism.verified, true);
    assert.equal(model.determinism.testedOrders, 6);
    assert.equal(new Set(hashes).size, 1);
    assert.equal(hashes[0], model.proposal.proposalHash);
  });

  it("routes an ambiguous reversible entity-link proposal to human review", async () => {
    const model = await buildDemoModel();
    const { decision } = model.entityResolution;

    assert.equal(decision.status, "needs_review");
    assert.equal(decision.humanReviewRequired, true);
    assert.equal(decision.reversible, true);
    assert.equal(decision.candidates.length, 2);
    assert.ok(decision.candidates.every(({ score }) => score === 1));
    assert.equal(model.entityResolution.deterministicAcrossInputOrder, true);
    assert.equal(model.boundary.entityLinkStatus, "proposal_only");
  });

  it("emits an explicit allow and a fail-closed default deny access receipt", async () => {
    const model = await buildDemoModel();
    const [allowed, denied] = model.purposeAccess.checks;

    assert.deepEqual(
      [allowed.receipt.decision, allowed.receipt.reasonCode],
      ["allow", "explicit_allow"]
    );
    assert.deepEqual(
      [denied.receipt.decision, denied.receipt.reasonCode],
      ["deny", "default_deny"]
    );
    assert.equal(denied.receipt.matchedRuleId, null);
    assert.notEqual(allowed.receipt.receiptHash, denied.receipt.receiptHash);
    assert.equal(model.boundary.accessReceiptStatus, "policy_evaluation_only");
  });

  it("keeps the assistant explicitly advisory-only", async () => {
    const model = await buildDemoModel();

    assert.equal(model.aiAssist.authority, "advisory_only");
    assert.equal(
      model.aiAssist.generatedFromProposalHash,
      model.proposal.proposalHash
    );
    assert.ok(model.aiAssist.mayNot.includes("activate a canonical record"));
    assert.ok(model.aiAssist.mayNot.includes("approve an entity link or merge"));
    assert.equal(model.humanReview.required, true);
  });
});

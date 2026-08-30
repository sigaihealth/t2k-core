import { semanticHash } from "@t2kai/core/compiler";

const DECISIONS = new Set(["approve_proposal", "return_for_correction"]);
const ALLOWED_INPUT_KEYS = new Set([
  "actorType",
  "attestation",
  "decision",
  "entitySelection",
  "proposalHash",
  "rationale",
  "reviewer",
  "reviewerRole",
  "selections",
]);

export class ReviewInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ReviewInputError";
    this.statusCode = statusCode;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, label, minimum, maximum) {
  if (typeof value !== "string") {
    throw new ReviewInputError(`${label} must be text.`);
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.length < minimum || cleaned.length > maximum) {
    throw new ReviewInputError(
      `${label} must be between ${minimum} and ${maximum} characters.`
    );
  }
  return cleaned;
}

function validateSelections(input, proposal) {
  const selections = input.selections ?? {};
  if (!isPlainObject(selections)) {
    throw new ReviewInputError("Selections must be an object.");
  }

  const reviewFields = proposal.fields.filter(
    (field) => field.status === "needs_review"
  );
  const reviewProperties = new Set(
    reviewFields.map((field) => field.propertyRef)
  );
  for (const propertyRef of Object.keys(selections)) {
    if (!reviewProperties.has(propertyRef)) {
      throw new ReviewInputError(
        `A selection is not allowed for ${propertyRef}.`
      );
    }
  }

  if (input.decision === "approve_proposal") {
    for (const field of reviewFields) {
      const selectedHash = selections[field.propertyRef];
      if (typeof selectedHash !== "string") {
        throw new ReviewInputError(
          `Select one candidate for ${field.propertyRef} before approval.`
        );
      }
      if (
        !field.candidates.some(
          (candidate) => candidate.valueHash === selectedHash
        )
      ) {
        throw new ReviewInputError(
          `The selected candidate for ${field.propertyRef} is not in this proposal.`
        );
      }
    }
  }

  return Object.fromEntries(
    Object.entries(selections).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

export class InMemoryReviewStore {
  #clock;
  #entityResolution;
  #proposal;
  #records = [];

  constructor({ proposal, entityResolution, clock = () => new Date() }) {
    this.#proposal = structuredClone(proposal);
    this.#entityResolution = structuredClone(entityResolution);
    this.#clock = clock;
  }

  add(input) {
    if (!isPlainObject(input)) {
      throw new ReviewInputError("Review input must be a JSON object.");
    }
    const unknownKeys = Object.keys(input).filter(
      (key) => !ALLOWED_INPUT_KEYS.has(key)
    );
    if (unknownKeys.length) {
      throw new ReviewInputError(
        `Unknown review fields: ${unknownKeys.sort().join(", ")}.`
      );
    }
    if (input.proposalHash !== this.#proposal.proposalHash) {
      throw new ReviewInputError(
        "The proposal changed. Refresh before recording a disposition.",
        409
      );
    }
    if (!DECISIONS.has(input.decision)) {
      throw new ReviewInputError("Choose a recognized review decision.");
    }
    if (input.actorType !== "human") {
      throw new ReviewInputError(
        "Only a human-attested review can enter the disposition log."
      );
    }
    if (input.reviewerRole !== "program_case_supervisor") {
      throw new ReviewInputError(
        "This proposal requires the program_case_supervisor role."
      );
    }
    if (input.attestation !== true) {
      throw new ReviewInputError(
        "Confirm the human-review attestation before submitting."
      );
    }

    const reviewer = cleanText(input.reviewer, "Reviewer name", 2, 80);
    const rationale = cleanText(input.rationale, "Rationale", 12, 500);
    const selections = validateSelections(input, this.#proposal);
    let entitySelection = null;
    if (input.entitySelection !== undefined) {
      if (typeof input.entitySelection !== "string") {
        throw new ReviewInputError("Entity-link selection must be text.");
      }
      const allowedEntitySelections = new Set([
        "no_link",
        ...this.#entityResolution.candidates.map(
          (candidate) => candidate.entityKey
        ),
      ]);
      if (!allowedEntitySelections.has(input.entitySelection)) {
        throw new ReviewInputError(
          "The entity-link selection is not in this proposal."
        );
      }
      entitySelection = input.entitySelection;
    }
    if (
      input.decision === "approve_proposal" &&
      this.#entityResolution.humanReviewRequired &&
      entitySelection === null
    ) {
      throw new ReviewInputError(
        "Choose an entity-link outcome before approval."
      );
    }
    const recordedAt = this.#clock().toISOString();
    const sequence = this.#records.length + 1;
    const recordBody = {
      sequence,
      proposalHash: this.#proposal.proposalHash,
      decision: input.decision,
      actorType: "human",
      reviewerRole: input.reviewerRole,
      reviewer,
      rationale,
      selections,
      entitySelection,
      recordedAt,
      storage: "ephemeral_memory",
      activationStatus: "not_activated",
      entityLinkStatus: "not_applied",
    };
    const record = {
      ...recordBody,
      dispositionHash: semanticHash(recordBody),
    };
    this.#records.push(record);
    return structuredClone(record);
  }

  snapshot() {
    return {
      storage: "ephemeral_memory",
      authenticatedReviewer: false,
      activationStatus: "not_implemented",
      count: this.#records.length,
      records: structuredClone(this.#records),
    };
  }
}

const byId = (id) => document.getElementById(id);

function make(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    element.setAttribute(name, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child) element.append(child);
  }
  return element;
}

function clear(element) {
  element.replaceChildren();
}

function shortHash(hash, length = 10) {
  return typeof hash === "string" ? `${hash.slice(0, length)}…` : "—";
}

function labelFor(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function statusBadge(status) {
  const styles = {
    selected: "status-selected",
    preserved: "status-preserved",
    needs_review: "status-review",
  };
  return make("span", {
    className: `status-badge ${styles[status] ?? "status-review"}`,
    text: labelFor(status),
  });
}

function renderMetrics(model) {
  const metrics = [
    [model.metrics.sourceCount, "independent agency sources"],
    [model.metrics.canonicalFieldCount, "canonical fields mapped"],
    [model.metrics.conflictedFieldCount, "conflicting fields preserved"],
    [model.metrics.unresolvedFieldCount, "field awaiting human judgment"],
  ];
  const container = byId("metrics");
  clear(container);
  for (const [value, label] of metrics) {
    container.append(
      make("div", { className: "metric" }, [
        make("span", { className: "metric-value", text: value }),
        make("span", { className: "metric-label", text: label }),
      ])
    );
  }
}

function renderHero(model) {
  byId("hero-title").textContent = model.meta.title;
  byId("hero-subtitle").textContent = model.meta.subtitle;
  byId("case-id").textContent = Object.values(model.proposal.identity).join(", ");
  byId("case-status").textContent = labelFor(model.proposal.status);
}

function factList(source) {
  const values = [
    ["Authority reference", source.authorityRef],
    ["Source schema", source.sourceSchemaVersion],
    ["Mapping", `${source.mapping.id}@${source.mapping.version}`],
    ["Receipt hash", source.receipt.receiptHash],
  ];
  const list = make("dl", { className: "source-facts" });
  for (const [term, value] of values) {
    list.append(
      make("div", {}, [make("dt", { text: term }), make("dd", { text: value })])
    );
  }
  return list;
}

function inspectionDetails(label, value, open = false) {
  const details = make("details");
  if (open) details.open = true;
  details.append(
    make("summary", { text: label }),
    make("pre", { text: JSON.stringify(value, null, 2) })
  );
  return details;
}

function sourceDetail(source) {
  const overview = make("div", { className: "source-overview" }, [
    make("span", { className: "receipt-badge", text: "✓ mapped receipt" }),
    make("h3", { text: source.agency.label }),
    make("p", {
      text: `Observed ${new Date(source.observedTime).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })}. The payload remains unchanged.`,
    }),
    factList(source),
  ]);

  const mappingFlow = make("div", { className: "mapping-flow" });
  for (const field of source.mapping.fields) {
    mappingFlow.append(
      make("div", { className: "mapping-row" }, [
        make("code", { text: field.sourcePath }),
        make("span", { className: "mapping-arrow", text: "→" }),
        make("code", { text: field.targetProperty }),
      ])
    );
  }
  const details = make("div", { className: "inspection-details" }, [
    inspectionDetails("Original source payload", source.payload, true),
    inspectionDetails("Canonical record + provenance", source.canonicalRecord),
    inspectionDetails("Complete mapping receipt", source.receipt),
  ]);
  const inspection = make("div", { className: "source-inspection" }, [
    make("p", { className: "card-kicker", text: "Field mapping" }),
    mappingFlow,
    details,
  ]);
  return [overview, inspection];
}

function renderSources(model) {
  const selector = byId("source-selector");
  const detail = byId("source-detail");
  const buttons = [];

  const selectSource = (index) => {
    buttons.forEach((button, buttonIndex) =>
      button.setAttribute("aria-pressed", String(buttonIndex === index))
    );
    detail.replaceChildren(...sourceDetail(model.agencies[index]));
  };

  model.agencies.forEach((source, index) => {
    const initials = source.agency.shortLabel.slice(0, 2).toUpperCase();
    const button = make(
      "button",
      {
        className: "source-button",
        attributes: { type: "button", "aria-pressed": index === 0 },
      },
      [
        make("span", {
          className: `source-icon accent-${source.agency.accent}`,
          text: initials,
        }),
        make("span", { className: "source-name" }, [
          make("strong", { text: source.agency.shortLabel }),
          make("span", { text: source.sourceSchemaVersion }),
        ]),
        make("span", { className: "source-state", text: source.receipt.status }),
      ]
    );
    button.addEventListener("click", () => selectSource(index));
    buttons.push(button);
    selector.append(button);
  });
  selectSource(0);
}

function candidateAgencyLabels(candidate, model) {
  const byAuthority = new Map(
    model.agencies.map((source) => [
      source.authorityRef,
      source.agency.shortLabel,
    ])
  );
  return [
    ...new Set(
      candidate.evidence.map(
        (evidence) =>
          byAuthority.get(evidence.receiptAuthorityRef) ??
          evidence.receiptAuthorityRef
      )
    ),
  ].join(" + ");
}

function fieldResolutionNote(field) {
  if (field.resolution === "single_value") {
    return "Every source that reported this field agrees after normalization.";
  }
  if (field.resolution === "preferred_authority") {
    return "A candidate is selected inside the proposal by the versioned authority order; it is not activated truth.";
  }
  if (field.resolution === "preserve_all") {
    return "All distinct values remain available. The policy intentionally selects no winner.";
  }
  return "The mapping requires a human to choose among the receipt-bound candidates.";
}

function renderProposal(model) {
  const summary = byId("proposal-summary");
  summary.append(
    statusBadge(model.proposal.status),
    make("span", {
      className: "hash-line",
      text: `proposal ${shortHash(model.proposal.proposalHash, 16)}`,
      attributes: { title: model.proposal.proposalHash },
    })
  );

  const grid = byId("field-grid");
  for (const field of model.proposal.fields) {
    const candidates = make("div", { className: "candidate-list" });
    for (const candidate of field.candidates) {
      const selected = candidate.valueHash === field.selectedValueHash;
      candidates.append(
        make("div", { className: `candidate${selected ? " selected" : ""}` }, [
          make("span", {
            className: "candidate-value",
            text: displayValue(candidate.value),
          }),
          make("span", {
            className: "candidate-source",
            text: `${candidateAgencyLabels(candidate, model)}${selected ? " · proposed" : ""}`,
          }),
        ])
      );
    }

    grid.append(
      make("article", { className: "field-card" }, [
        make("div", { className: "field-topline" }, [
          make("h3", { className: "field-name", text: field.propertyRef }),
          statusBadge(field.status),
        ]),
        make("p", {
          className: "resolution-note",
          text: fieldResolutionNote(field),
        }),
        candidates,
      ])
    );
  }
}

function renderEntityResolution(model) {
  const container = byId("entity-link-content");
  const { decision, boundary, deterministicAcrossInputOrder } =
    model.entityResolution;
  const candidateList = make("div", { className: "entity-candidates" });
  for (const candidate of decision.candidates) {
    candidateList.append(
      make("div", { className: "entity-candidate" }, [
        make("code", { text: candidate.entityKey }),
        make("span", {
          className: "score",
          text: `${Math.round(candidate.score * 100)}% score`,
        }),
      ])
    );
  }
  container.append(
    statusBadge(decision.status),
    make("p", { className: "entity-rationale", text: decision.rationale }),
    candidateList,
    make("p", {
      className: "hash-line",
      text: `${deterministicAcrossInputOrder ? "✓ deterministic" : "✕ changed"} · reversible ${decision.reversible ? "yes" : "no"} · ${shortHash(decision.decisionHash, 14)}`,
      attributes: { title: decision.decisionHash },
    }),
    make("p", { className: "governance-boundary", text: boundary })
  );
}

function renderPurposeAccess(model) {
  const container = byId("access-receipts");
  for (const check of model.purposeAccess.checks) {
    const { receipt } = check;
    container.append(
      make("article", { className: `access-receipt ${receipt.decision}` }, [
        make("div", { className: "receipt-topline" }, [
          make("strong", { text: check.label }),
          make("span", {
            className: "receipt-decision",
            text: `${receipt.decision} · ${labelFor(receipt.reasonCode)}`,
          }),
        ]),
        make("p", { text: receipt.reason }),
        make("code", {
          text: `receipt ${shortHash(receipt.receiptHash, 16)}`,
          attributes: { title: receipt.receiptHash },
        }),
      ])
    );
  }
  container.append(
    make("p", {
      className: "governance-boundary",
      text: model.purposeAccess.boundary,
    })
  );
}

function renderDeterminism(model) {
  const checks = byId("hash-checks");
  for (const item of model.determinism.proposalHashes) {
    checks.append(
      make("div", { className: "hash-check" }, [
        make("span", { className: "hash-check-icon", text: "✓" }),
        make("strong", { text: item.label }),
        make("code", {
          text: shortHash(item.proposalHash, 18),
          attributes: { title: item.proposalHash },
        }),
      ])
    );
  }
}

function renderBoundary(model) {
  byId("ai-summary").textContent = model.aiAssist.summary;
  const may = byId("ai-may");
  for (const item of model.aiAssist.may) {
    may.append(make("li", { text: item }));
  }
  const observations = byId("ai-observations");
  for (const observation of model.aiAssist.observations) {
    observations.append(
      make("div", { className: "observation" }, [
        make("strong", { text: observation.propertyRef }),
        make("span", { text: observation.message }),
      ])
    );
  }
  byId("boundary-note").textContent = model.boundary.note;
}

function reviewCandidateLabel(candidate, model) {
  const fullCandidate = model.proposal.fields
    .flatMap((field) => field.candidates)
    .find((item) => item.valueHash === candidate.valueHash);
  const agencies = fullCandidate
    ? candidateAgencyLabels(fullCandidate, model)
    : `${candidate.evidenceCount} source${candidate.evidenceCount === 1 ? "" : "s"}`;
  return { value: displayValue(candidate.value), agencies };
}

function canonicalReviewFields(model) {
  const container = make("div");
  for (const field of model.humanReview.unresolvedFields) {
    const fieldset = make("fieldset", { className: "review-fieldset" });
    fieldset.append(
      make("legend", { text: `Resolve ${labelFor(field.propertyRef)}` }),
      make("p", {
        text: "Select the candidate the human disposition should carry. Core has not selected one.",
      })
    );
    for (const candidate of field.candidates) {
      const input = make("input", {
        attributes: {
          type: "radio",
          name: `field-${field.propertyRef}`,
          value: candidate.valueHash,
          required: "",
        },
      });
      input.dataset.property = field.propertyRef;
      input.classList.add("review-choice");
      const copy = reviewCandidateLabel(candidate, model);
      fieldset.append(
        make("label", { className: "radio-candidate" }, [
          input,
          make("span", { className: "radio-copy" }, [
            make("strong", { text: copy.value }),
            make("span", { text: `Evidence: ${copy.agencies}` }),
          ]),
        ])
      );
    }
    container.append(fieldset);
  }
  return container;
}

function entityReviewField(model) {
  const decision = model.entityResolution.decision;
  const fieldset = make("fieldset", { className: "review-fieldset" });
  fieldset.append(
    make("legend", { text: "Resolve the entity-link proposal" }),
    make("p", {
      text: "Two entities scored equally. Choose a link target or explicitly keep them separate.",
    })
  );
  const options = [
    ...decision.candidates.map((candidate) => ({
      value: candidate.entityKey,
      label: candidate.entityKey,
      note: `${Math.round(candidate.score * 100)}% evidence score · proposed link only`,
    })),
    {
      value: "no_link",
      label: "Keep separate",
      note: "Record no link for this review packet",
    },
  ];
  for (const option of options) {
    const input = make("input", {
      className: "review-choice",
      attributes: {
        type: "radio",
        name: "entity-selection",
        value: option.value,
        required: "",
      },
    });
    fieldset.append(
      make("label", { className: "radio-candidate" }, [
        input,
        make("span", { className: "radio-copy" }, [
          make("strong", { text: option.label }),
          make("span", { text: option.note }),
        ]),
      ])
    );
  }
  return fieldset;
}

function renderReviewLog(reviewLog) {
  const container = byId("review-log-records");
  clear(container);
  if (reviewLog.records.length === 0) {
    container.append(
      make("div", {
        className: "empty-log",
        text: "No disposition has been recorded in this server session.",
      })
    );
    return;
  }
  const records = make("div", { className: "log-records" });
  for (const record of [...reviewLog.records].reverse()) {
    records.append(
      make("article", { className: "log-record" }, [
        make("span", { className: "log-sequence", text: record.sequence }),
        make("div", {}, [
          make("p", {
            text: `${record.reviewer} · ${labelFor(record.decision)}`,
          }),
          make("p", { text: record.rationale }),
          make("span", {
            className: "log-meta",
            text: `${new Date(record.recordedAt).toLocaleString()} · ${labelFor(record.storage)} · not activated · ${shortHash(record.dispositionHash, 12)}`,
          }),
        ]),
      ])
    );
  }
  container.append(records);
}

function renderReview(model) {
  const fields = byId("review-fields");
  fields.append(canonicalReviewFields(model), entityReviewField(model));
  renderReviewLog(model.reviewLog);

  const form = byId("review-form");
  const decision = byId("decision");
  const status = byId("form-status");
  const submitButton = form.querySelector("button[type='submit']");

  const updateRequiredChoices = () => {
    const approval = decision.value === "approve_proposal";
    form
      .querySelectorAll(".review-choice")
      .forEach((input) => (input.required = approval));
  };
  decision.addEventListener("change", updateRequiredChoices);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.className = "form-status";
    status.textContent = "Recording the separate human disposition…";
    submitButton.disabled = true;

    const selections = {};
    form
      .querySelectorAll("input[data-property]:checked")
      .forEach((input) => (selections[input.dataset.property] = input.value));
    const entitySelection = form.querySelector(
      "input[name='entity-selection']:checked"
    )?.value;
    const payload = {
      proposalHash: model.proposal.proposalHash,
      decision: decision.value,
      actorType: "human",
      reviewerRole: model.humanReview.requiredRole,
      reviewer: byId("reviewer").value,
      rationale: byId("rationale").value,
      attestation: byId("attestation").checked,
      selections,
      ...(entitySelection ? { entitySelection } : {}),
    };

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Review was not recorded.");
      status.className = "form-status success";
      status.textContent =
        "Disposition recorded in memory. Proposal, entity links, and activation remain unchanged.";
      renderReviewLog(result.reviewLog);
      form.reset();
      updateRequiredChoices();
    } catch (error) {
      status.className = "form-status error";
      status.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function start() {
  const response = await fetch("/api/demo", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Demo API returned ${response.status}.`);
  const model = await response.json();

  renderHero(model);
  renderMetrics(model);
  renderSources(model);
  renderProposal(model);
  renderEntityResolution(model);
  renderPurposeAccess(model);
  renderDeterminism(model);
  renderBoundary(model);
  renderReview(model);
}

start().catch((error) => {
  console.error(error);
  const banner = make("div", {
    className: "error-banner",
    text: `The demo could not load: ${error.message}`,
    attributes: { role: "alert" },
  });
  byId("main-content").prepend(banner);
});

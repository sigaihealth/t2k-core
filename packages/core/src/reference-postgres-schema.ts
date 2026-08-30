export const REFERENCE_LIFECYCLE_SCHEMA_VERSION = 2;

export const REFERENCE_LIFECYCLE_SCHEMA_SQL = String.raw`
CREATE SCHEMA IF NOT EXISTS t2k_reference;

CREATE TABLE IF NOT EXISTS t2k_reference.schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.reasoning_policies (
  id UUID PRIMARY KEY,
  policy_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  decision_type TEXT NOT NULL UNIQUE,
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired')),
  active_version_id UUID,
  created_by_actor_type TEXT NOT NULL
    CHECK (created_by_actor_type IN ('human', 'agent', 'system')),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.reasoning_policy_versions (
  id UUID PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policies(id),
  policy_version TEXT NOT NULL,
  learning_mode TEXT NOT NULL
    CHECK (learning_mode IN ('none', 'supervised_feedback', 'contextual_bandit', 'sequential_rl', 'optimization')),
  specification JSONB NOT NULL,
  reward_spec JSONB NOT NULL DEFAULT '[]'::jsonb,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'accepted', 'deployed', 'rolled_back')),
  content_hash TEXT NOT NULL,
  parent_version_id UUID REFERENCES t2k_reference.reasoning_policy_versions(id),
  rationale TEXT NOT NULL,
  evaluation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_by_actor_type TEXT NOT NULL
    CHECK (proposed_by_actor_type IN ('human', 'agent', 'system')),
  proposed_by_actor_id TEXT NOT NULL,
  reviewed_by_actor_id TEXT,
  reviewed_at TIMESTAMPTZ,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, policy_version),
  UNIQUE (policy_id, content_hash)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS relations
      ON relations.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE constraints.conname = 't2k_reference_active_policy_version_fk'
      AND namespaces.nspname = 't2k_reference'
      AND relations.relname = 'reasoning_policies'
  ) THEN
    ALTER TABLE t2k_reference.reasoning_policies
      ADD CONSTRAINT t2k_reference_active_policy_version_fk
      FOREIGN KEY (active_version_id)
      REFERENCES t2k_reference.reasoning_policy_versions(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS t2k_reference.decision_contexts (
  id UUID PRIMARY KEY,
  context_key TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  state_snapshot JSONB NOT NULL,
  objective JSONB NOT NULL,
  constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_authority JSONB NOT NULL DEFAULT '{}'::jsonb,
  learning_contract JSONB NOT NULL,
  policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  policy_content_hash TEXT NOT NULL,
  context_hash TEXT NOT NULL UNIQUE,
  created_by_actor_type TEXT NOT NULL
    CHECK (created_by_actor_type IN ('human', 'agent', 'system')),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.recommendations (
  id UUID PRIMARY KEY,
  decision_context_id UUID NOT NULL REFERENCES t2k_reference.decision_contexts(id),
  recommendation_key TEXT NOT NULL UNIQUE,
  policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  proposed_action TEXT NOT NULL,
  behavior_probability DOUBLE PRECISION NOT NULL DEFAULT 1
    CHECK (behavior_probability > 0 AND behavior_probability <= 1),
  rationale TEXT NOT NULL,
  reasoning_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_by_actor_type TEXT NOT NULL
    CHECK (proposed_by_actor_type IN ('human', 'agent', 'system')),
  proposed_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.authorized_decisions (
  id UUID PRIMARY KEY,
  recommendation_id UUID NOT NULL UNIQUE REFERENCES t2k_reference.recommendations(id),
  selected_action TEXT NOT NULL,
  rationale TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorized_by_actor_id TEXT NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.decision_episodes (
  id UUID PRIMARY KEY,
  episode_key TEXT NOT NULL UNIQUE,
  decision_context_id UUID NOT NULL REFERENCES t2k_reference.decision_contexts(id),
  authorized_decision_id UUID NOT NULL UNIQUE REFERENCES t2k_reference.authorized_decisions(id),
  policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  learning_mode TEXT NOT NULL
    CHECK (learning_mode IN ('none', 'supervised_feedback', 'contextual_bandit', 'sequential_rl', 'optimization')),
  state_snapshot JSONB NOT NULL,
  learning_contract JSONB NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'open'
    CHECK (lifecycle_status IN ('open', 'closed')),
  external_effect BOOLEAN NOT NULL DEFAULT TRUE,
  opened_by_actor_type TEXT NOT NULL
    CHECK (opened_by_actor_type IN ('human', 'agent', 'system')),
  opened_by_actor_id TEXT NOT NULL,
  closed_by_actor_id TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closure_rationale TEXT
);

CREATE TABLE IF NOT EXISTS t2k_reference.execution_receipts (
  id UUID PRIMARY KEY,
  decision_episode_id UUID NOT NULL REFERENCES t2k_reference.decision_episodes(id),
  receipt_key TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  connector_ref TEXT NOT NULL,
  external_transaction_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'unknown')),
  request_hash TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status TEXT NOT NULL
    CHECK (reconciliation_status IN ('pending', 'reconciled', 'mismatch')),
  recorded_by_actor_type TEXT NOT NULL
    CHECK (recorded_by_actor_type IN ('human', 'agent', 'system')),
  recorded_by_actor_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.episode_observations (
  id UUID PRIMARY KEY,
  decision_episode_id UUID NOT NULL REFERENCES t2k_reference.decision_episodes(id),
  measure_ref TEXT NOT NULL,
  observed_value JSONB NOT NULL,
  baseline_value JSONB,
  unit TEXT,
  observation_window TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution_confidence DOUBLE PRECISION
    CHECK (attribution_confidence IS NULL OR (attribution_confidence >= 0 AND attribution_confidence <= 1)),
  recorded_by_actor_type TEXT NOT NULL
    CHECK (recorded_by_actor_type IN ('human', 'agent', 'system')),
  recorded_by_actor_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.reward_assessments (
  id UUID PRIMARY KEY,
  decision_episode_id UUID NOT NULL REFERENCES t2k_reference.decision_episodes(id),
  assessment_key TEXT NOT NULL,
  reward_spec_hash TEXT NOT NULL,
  dimensions JSONB NOT NULL,
  scalar_reward DOUBLE PRECISION,
  evaluation_reward DOUBLE PRECISION,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('complete', 'incomplete', 'guardrail_violation')),
  assessed_by_actor_type TEXT NOT NULL
    CHECK (assessed_by_actor_type IN ('human', 'agent', 'system')),
  assessed_by_actor_id TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (decision_episode_id, assessment_key)
);

ALTER TABLE t2k_reference.reward_assessments
  ADD COLUMN IF NOT EXISTS evaluation_reward DOUBLE PRECISION;

UPDATE t2k_reference.reward_assessments
SET evaluation_reward = CASE
  WHEN lifecycle_status = 'complete' THEN scalar_reward
  WHEN lifecycle_status = 'guardrail_violation' THEN -1
  ELSE NULL
END
WHERE evaluation_reward IS NULL;

CREATE TABLE IF NOT EXISTS t2k_reference.learning_candidates (
  id UUID PRIMARY KEY,
  candidate_key TEXT NOT NULL UNIQUE,
  policy_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policies(id),
  source_policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  proposed_policy_version TEXT NOT NULL,
  proposed_specification JSONB NOT NULL,
  proposed_reward_spec JSONB NOT NULL,
  training_episode_ids UUID[] NOT NULL,
  rationale TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (lifecycle_status IN ('proposed', 'promoted', 'rejected')),
  proposed_by_actor_type TEXT NOT NULL
    CHECK (proposed_by_actor_type IN ('human', 'agent', 'system')),
  proposed_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, proposed_policy_version)
);

CREATE TABLE IF NOT EXISTS t2k_reference.policy_evaluations (
  id UUID PRIMARY KEY,
  learning_candidate_id UUID NOT NULL REFERENCES t2k_reference.learning_candidates(id),
  evaluation_key TEXT NOT NULL UNIQUE,
  evaluation_type TEXT NOT NULL DEFAULT 'historical_replay'
    CHECK (evaluation_type = 'historical_replay'),
  baseline_policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  holdout_episode_ids UUID[] NOT NULL,
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('passed', 'failed', 'needs_review')),
  metrics JSONB NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluated_by_actor_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.policy_promotions (
  id UUID PRIMARY KEY,
  learning_candidate_id UUID NOT NULL UNIQUE REFERENCES t2k_reference.learning_candidates(id),
  promoted_policy_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  previous_active_version_id UUID NOT NULL REFERENCES t2k_reference.reasoning_policy_versions(id),
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('accepted', 'deployed', 'rolled_back')),
  review_rationale TEXT NOT NULL,
  promoted_by_actor_id TEXT NOT NULL,
  deployed_at TIMESTAMPTZ,
  rolled_back_by_actor_id TEXT,
  rolled_back_at TIMESTAMPTZ,
  rollback_rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_objects (
  id UUID PRIMARY KEY,
  object_type TEXT NOT NULL CHECK (BTRIM(object_type) <> ''),
  object_key TEXT NOT NULL CHECK (BTRIM(object_key) <> ''),
  active_revision_id UUID,
  created_by_actor_type TEXT NOT NULL
    CHECK (created_by_actor_type IN ('human', 'agent', 'system')),
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t2k_reference_reconciliation_object_identity_uq
    UNIQUE (object_type, object_key),
  CONSTRAINT t2k_reference_reconciliation_object_id_identity_uq
    UNIQUE (id, object_type, object_key)
);

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_proposals (
  id UUID PRIMARY KEY,
  proposal_key TEXT NOT NULL UNIQUE CHECK (BTRIM(proposal_key) <> ''),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (BTRIM(idempotency_key) <> ''),
  canonical_object_id UUID NOT NULL,
  object_type TEXT NOT NULL CHECK (BTRIM(object_type) <> ''),
  object_key TEXT NOT NULL CHECK (BTRIM(object_key) <> ''),
  base_revision_id UUID,
  proposed_content JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  evidence JSONB NOT NULL,
  execution_evidence_hash TEXT NOT NULL
    CHECK (execution_evidence_hash ~ '^[0-9a-f]{64}$'),
  required_reviewer_role TEXT NOT NULL
    CHECK (BTRIM(required_reviewer_role) <> ''),
  rationale TEXT NOT NULL CHECK (BTRIM(rationale) <> ''),
  proposal_hash TEXT NOT NULL UNIQUE
    CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  proposed_by_actor_type TEXT NOT NULL
    CHECK (proposed_by_actor_type IN ('human', 'agent', 'system')),
  proposed_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t2k_reference_reconciliation_proposal_object_fk
    FOREIGN KEY (canonical_object_id, object_type, object_key)
    REFERENCES t2k_reference.reconciliation_objects(
      id, object_type, object_key
    ),
  CONSTRAINT t2k_reference_reconciliation_proposal_id_object_uq
    UNIQUE (id, canonical_object_id),
  CONSTRAINT t2k_reference_reconciliation_proposal_base_uq
    UNIQUE (id, canonical_object_id, base_revision_id)
);

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_proposal_receipts (
  proposal_id UUID NOT NULL,
  receipt_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  receipt_snapshot JSONB NOT NULL,
  receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (proposal_id, receipt_id),
  UNIQUE (proposal_id, position),
  CONSTRAINT t2k_reference_reconciliation_receipt_proposal_fk
    FOREIGN KEY (proposal_id)
    REFERENCES t2k_reference.reconciliation_proposals(id),
  CONSTRAINT t2k_reference_reconciliation_receipt_execution_fk
    FOREIGN KEY (receipt_id)
    REFERENCES t2k_reference.execution_receipts(id)
);

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_dispositions (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL UNIQUE
    CONSTRAINT t2k_reference_reconciliation_disposition_proposal_fk
    REFERENCES t2k_reference.reconciliation_proposals(id),
  disposition_version INTEGER NOT NULL DEFAULT 1
    CHECK (disposition_version = 1),
  expected_disposition_version INTEGER NOT NULL
    CHECK (expected_disposition_version = 0),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer_role TEXT NOT NULL CHECK (BTRIM(reviewer_role) <> ''),
  rationale TEXT NOT NULL CHECK (BTRIM(rationale) <> ''),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (BTRIM(idempotency_key) <> ''),
  reviewed_by_actor_type TEXT NOT NULL DEFAULT 'human'
    CHECK (reviewed_by_actor_type = 'human'),
  reviewed_by_actor_id TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT t2k_reference_reconciliation_disposition_id_proposal_uq
    UNIQUE (id, proposal_id)
);

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_revisions (
  id UUID PRIMARY KEY,
  canonical_object_id UUID NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  content JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  parent_revision_id UUID,
  proposal_id UUID NOT NULL UNIQUE,
  approval_disposition_id UUID NOT NULL UNIQUE,
  accepted_by_actor_type TEXT NOT NULL DEFAULT 'human'
    CHECK (accepted_by_actor_type = 'human'),
  accepted_by_actor_id TEXT NOT NULL,
  accepted_by_role TEXT NOT NULL CHECK (BTRIM(accepted_by_role) <> ''),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_object_id, revision_number),
  UNIQUE (canonical_object_id, content_hash),
  CONSTRAINT t2k_reference_reconciliation_revision_id_object_uq
    UNIQUE (id, canonical_object_id),
  CONSTRAINT t2k_reference_reconciliation_revision_acceptance_lineage_uq
    UNIQUE (
      id, canonical_object_id, proposal_id, approval_disposition_id
    ),
  CONSTRAINT t2k_reference_reconciliation_revision_lineage_uq
    UNIQUE (
      id, canonical_object_id, proposal_id, approval_disposition_id,
      parent_revision_id
    ),
  CONSTRAINT t2k_reference_reconciliation_revision_object_fk
    FOREIGN KEY (canonical_object_id)
    REFERENCES t2k_reference.reconciliation_objects(id),
  CONSTRAINT t2k_reference_reconciliation_revision_parent_object_fk
    FOREIGN KEY (parent_revision_id, canonical_object_id)
    REFERENCES t2k_reference.reconciliation_revisions(
      id, canonical_object_id
    ),
  CONSTRAINT t2k_reference_reconciliation_revision_proposal_object_fk
    FOREIGN KEY (proposal_id, canonical_object_id)
    REFERENCES t2k_reference.reconciliation_proposals(
      id, canonical_object_id
    ),
  CONSTRAINT t2k_reference_reconciliation_revision_proposal_base_fk
    FOREIGN KEY (proposal_id, canonical_object_id, parent_revision_id)
    REFERENCES t2k_reference.reconciliation_proposals(
      id, canonical_object_id, base_revision_id
    ),
  CONSTRAINT t2k_reference_reconciliation_revision_disposition_proposal_fk
    FOREIGN KEY (approval_disposition_id, proposal_id)
    REFERENCES t2k_reference.reconciliation_dispositions(id, proposal_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS relations
      ON relations.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE constraints.conname =
            't2k_reference_reconciliation_active_revision_fk'
      AND namespaces.nspname = 't2k_reference'
      AND relations.relname = 'reconciliation_objects'
  ) THEN
    ALTER TABLE t2k_reference.reconciliation_objects
      ADD CONSTRAINT t2k_reference_reconciliation_active_revision_fk
      FOREIGN KEY (active_revision_id, id)
      REFERENCES t2k_reference.reconciliation_revisions(
        id, canonical_object_id
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS relations
      ON relations.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE constraints.conname =
            't2k_reference_reconciliation_base_revision_fk'
      AND namespaces.nspname = 't2k_reference'
      AND relations.relname = 'reconciliation_proposals'
  ) THEN
    ALTER TABLE t2k_reference.reconciliation_proposals
      ADD CONSTRAINT t2k_reference_reconciliation_base_revision_fk
      FOREIGN KEY (base_revision_id, canonical_object_id)
      REFERENCES t2k_reference.reconciliation_revisions(
        id, canonical_object_id
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS t2k_reference.reconciliation_activations (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  canonical_object_id UUID NOT NULL,
  activated_revision_id UUID NOT NULL,
  previous_revision_id UUID,
  activation_type TEXT NOT NULL
    CHECK (activation_type IN ('acceptance', 'rollback', 'reactivation')),
  source_proposal_id UUID,
  approval_disposition_id UUID,
  rationale TEXT NOT NULL CHECK (BTRIM(rationale) <> ''),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (BTRIM(idempotency_key) <> ''),
  activated_by_actor_type TEXT NOT NULL DEFAULT 'human'
    CHECK (activated_by_actor_type = 'human'),
  activated_by_actor_id TEXT NOT NULL,
  activated_by_role TEXT NOT NULL CHECK (BTRIM(activated_by_role) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (activation_type = 'acceptance'
      AND source_proposal_id IS NOT NULL
      AND approval_disposition_id IS NOT NULL)
    OR
    (activation_type IN ('rollback', 'reactivation')
      AND source_proposal_id IS NULL
      AND approval_disposition_id IS NULL
      AND previous_revision_id IS NOT NULL)
  ),
  CONSTRAINT t2k_reference_reconciliation_activation_id_object_uq
    UNIQUE (id, canonical_object_id),
  CONSTRAINT t2k_reference_reconciliation_activation_object_fk
    FOREIGN KEY (canonical_object_id)
    REFERENCES t2k_reference.reconciliation_objects(id),
  CONSTRAINT t2k_reference_reconciliation_activation_target_object_fk
    FOREIGN KEY (activated_revision_id, canonical_object_id)
    REFERENCES t2k_reference.reconciliation_revisions(
      id, canonical_object_id
    ),
  CONSTRAINT t2k_reference_reconciliation_activation_previous_object_fk
    FOREIGN KEY (previous_revision_id, canonical_object_id)
    REFERENCES t2k_reference.reconciliation_revisions(
      id, canonical_object_id
    ),
  CONSTRAINT t2k_reference_reconciliation_activation_proposal_object_fk
    FOREIGN KEY (source_proposal_id, canonical_object_id)
    REFERENCES t2k_reference.reconciliation_proposals(
      id, canonical_object_id
    ),
  CONSTRAINT t2k_reference_reconciliation_activation_disposition_proposal_fk
    FOREIGN KEY (approval_disposition_id, source_proposal_id)
    REFERENCES t2k_reference.reconciliation_dispositions(id, proposal_id),
  CONSTRAINT t2k_reference_reconciliation_activation_revision_lineage_fk
    FOREIGN KEY (
      activated_revision_id, canonical_object_id, source_proposal_id,
      approval_disposition_id
    ) REFERENCES t2k_reference.reconciliation_revisions(
      id, canonical_object_id, proposal_id, approval_disposition_id
    ),
  CONSTRAINT t2k_reference_reconciliation_activation_parent_lineage_fk
    FOREIGN KEY (
      activated_revision_id, canonical_object_id, source_proposal_id,
      approval_disposition_id, previous_revision_id
    ) REFERENCES t2k_reference.reconciliation_revisions(
      id, canonical_object_id, proposal_id, approval_disposition_id,
      parent_revision_id
    )
);

CREATE TABLE IF NOT EXISTS t2k_reference.lifecycle_events (
  sequence BIGSERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS t2k_reference_episode_policy_idx
  ON t2k_reference.decision_episodes(policy_version_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS t2k_reference_observation_episode_idx
  ON t2k_reference.episode_observations(decision_episode_id, observed_at);
CREATE INDEX IF NOT EXISTS t2k_reference_assessment_episode_idx
  ON t2k_reference.reward_assessments(decision_episode_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS t2k_reference_evaluation_candidate_idx
  ON t2k_reference.policy_evaluations(learning_candidate_id, created_at);
CREATE INDEX IF NOT EXISTS t2k_reference_reconciliation_proposal_object_idx
  ON t2k_reference.reconciliation_proposals(canonical_object_id, created_at);
CREATE INDEX IF NOT EXISTS t2k_reference_reconciliation_revision_object_idx
  ON t2k_reference.reconciliation_revisions(
    canonical_object_id, revision_number
  );
CREATE INDEX IF NOT EXISTS t2k_reference_reconciliation_activation_object_idx
  ON t2k_reference.reconciliation_activations(
    canonical_object_id, sequence
  );
CREATE UNIQUE INDEX IF NOT EXISTS
  t2k_reference_reconciliation_acceptance_revision_uq
  ON t2k_reference.reconciliation_activations(activated_revision_id)
  WHERE activation_type = 'acceptance';
CREATE UNIQUE INDEX IF NOT EXISTS
  t2k_reference_reconciliation_acceptance_proposal_uq
  ON t2k_reference.reconciliation_activations(source_proposal_id)
  WHERE activation_type = 'acceptance';

CREATE OR REPLACE FUNCTION t2k_reference.prevent_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 't2k_reference.lifecycle_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS t2k_reference_events_append_only
  ON t2k_reference.lifecycle_events;
CREATE TRIGGER t2k_reference_events_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.lifecycle_events
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_event_mutation();

DROP TRIGGER IF EXISTS t2k_reference_events_no_truncate
  ON t2k_reference.lifecycle_events;
CREATE TRIGGER t2k_reference_events_no_truncate
BEFORE TRUNCATE ON t2k_reference.lifecycle_events
FOR EACH STATEMENT EXECUTE FUNCTION t2k_reference.prevent_event_mutation();

CREATE OR REPLACE FUNCTION t2k_reference.prevent_reconciliation_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 't2k_reference.% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION t2k_reference.prevent_reconciliation_object_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 't2k_reference.reconciliation_objects identity is immutable';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR
     OLD.object_type IS DISTINCT FROM NEW.object_type OR
     OLD.object_key IS DISTINCT FROM NEW.object_key OR
     OLD.created_by_actor_type IS DISTINCT FROM NEW.created_by_actor_type OR
     OLD.created_by_actor_id IS DISTINCT FROM NEW.created_by_actor_id OR
     OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 't2k_reference.reconciliation_objects identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_objects_identity_immutable
  ON t2k_reference.reconciliation_objects;
CREATE TRIGGER t2k_reference_reconciliation_objects_identity_immutable
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_objects
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_object_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_objects_no_truncate
  ON t2k_reference.reconciliation_objects;
CREATE TRIGGER t2k_reference_reconciliation_objects_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_objects
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

CREATE OR REPLACE FUNCTION t2k_reference.check_reconciliation_active_activation(
  checked_object_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  active_revision UUID;
  latest_activated_revision UUID;
BEGIN
  SELECT objects.active_revision_id
    INTO active_revision
  FROM t2k_reference.reconciliation_objects AS objects
  WHERE objects.id = checked_object_id;

  SELECT activations.activated_revision_id
    INTO latest_activated_revision
  FROM t2k_reference.reconciliation_activations AS activations
  WHERE activations.canonical_object_id = checked_object_id
  ORDER BY activations.sequence DESC
  LIMIT 1;

  IF active_revision IS DISTINCT FROM latest_activated_revision THEN
    RAISE EXCEPTION
      'active reconciliation revision must match the latest activation for object %',
      checked_object_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION t2k_reference.assert_reconciliation_object_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM t2k_reference.check_reconciliation_active_activation(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION t2k_reference.assert_reconciliation_activation_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  accepted_parent_revision UUID;
  acceptance_decision TEXT;
  target_proposer TEXT;
  target_reviewer TEXT;
  target_accepter TEXT;
  target_accepted_role TEXT;
  previous_proposer TEXT;
  previous_reviewer TEXT;
  previous_accepter TEXT;
  prior_activation_actor TEXT;
  prior_activated_revision UUID;
  rollback_target_is_ancestor BOOLEAN;
  later_activation_exists BOOLEAN;
BEGIN
  PERFORM t2k_reference.check_reconciliation_active_activation(
    NEW.canonical_object_id
  );

  SELECT EXISTS (
    SELECT 1
    FROM t2k_reference.reconciliation_activations AS activations
    WHERE activations.canonical_object_id = NEW.canonical_object_id
      AND activations.sequence > NEW.sequence
  ) INTO later_activation_exists;
  IF later_activation_exists THEN
    RAISE EXCEPTION
      'new activation must be the latest activation for its object'
      USING ERRCODE = '23514';
  END IF;

  SELECT activations.activated_revision_id,
         activations.activated_by_actor_id
    INTO prior_activated_revision, prior_activation_actor
  FROM t2k_reference.reconciliation_activations AS activations
  WHERE activations.canonical_object_id = NEW.canonical_object_id
    AND activations.sequence < NEW.sequence
  ORDER BY activations.sequence DESC
  LIMIT 1;
  IF FOUND THEN
    IF NEW.previous_revision_id IS DISTINCT FROM prior_activated_revision THEN
      RAISE EXCEPTION
        'activation previous revision must equal the immediately preceding activation target'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.previous_revision_id IS NOT NULL THEN
    RAISE EXCEPTION
      'the first activation for an object must have a NULL previous revision'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.activation_type IN ('rollback', 'reactivation') AND
     NEW.activated_revision_id = NEW.previous_revision_id THEN
    RAISE EXCEPTION
      'rollback and reactivation targets must differ from the previous revision'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.activation_type = 'acceptance' THEN
    SELECT revisions.parent_revision_id, dispositions.decision,
           proposals.proposed_by_actor_id,
           dispositions.reviewed_by_actor_id,
           revisions.accepted_by_actor_id,
           revisions.accepted_by_role
      INTO accepted_parent_revision, acceptance_decision,
           target_proposer, target_reviewer, target_accepter,
           target_accepted_role
    FROM t2k_reference.reconciliation_revisions AS revisions
    INNER JOIN t2k_reference.reconciliation_proposals AS proposals
      ON proposals.id = revisions.proposal_id
    INNER JOIN t2k_reference.reconciliation_dispositions AS dispositions
      ON dispositions.id = revisions.approval_disposition_id
    WHERE revisions.id = NEW.activated_revision_id
      AND revisions.canonical_object_id = NEW.canonical_object_id
      AND revisions.proposal_id = NEW.source_proposal_id
      AND revisions.approval_disposition_id = NEW.approval_disposition_id;

    IF NOT FOUND OR acceptance_decision <> 'approved' OR
       NEW.previous_revision_id IS DISTINCT FROM accepted_parent_revision THEN
      RAISE EXCEPTION
        'acceptance activation must use an approved revision and its exact parent'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.activated_by_actor_id <> target_accepter OR
       NEW.activated_by_role <> target_accepted_role THEN
      RAISE EXCEPTION
        'acceptance activation actor and role must match the accepted revision'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.activated_by_actor_id IN (target_proposer, target_reviewer) THEN
      RAISE EXCEPTION
        'acceptance actor must be separate from proposer and reviewer'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT proposals.proposed_by_actor_id,
           dispositions.reviewed_by_actor_id,
           revisions.accepted_by_actor_id
      INTO previous_proposer, previous_reviewer, previous_accepter
    FROM t2k_reference.reconciliation_revisions AS revisions
    INNER JOIN t2k_reference.reconciliation_proposals AS proposals
      ON proposals.id = revisions.proposal_id
    INNER JOIN t2k_reference.reconciliation_dispositions AS dispositions
      ON dispositions.id = revisions.approval_disposition_id
    WHERE revisions.id = NEW.previous_revision_id
      AND revisions.canonical_object_id = NEW.canonical_object_id;

    IF NOT FOUND OR NEW.activated_by_actor_id IN (
      previous_proposer, previous_reviewer, previous_accepter
    ) THEN
      RAISE EXCEPTION
        'rollback and reactivation actors must be separate from the active revision governance actors'
        USING ERRCODE = '23514';
    END IF;

    IF prior_activation_actor = NEW.activated_by_actor_id THEN
      RAISE EXCEPTION
        'rollback and reactivation require separation from the prior activation actor'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.activation_type = 'rollback' THEN
      WITH RECURSIVE ancestors AS (
        SELECT revisions.id, revisions.parent_revision_id
        FROM t2k_reference.reconciliation_revisions AS revisions
        WHERE revisions.id = NEW.previous_revision_id
          AND revisions.canonical_object_id = NEW.canonical_object_id
        UNION ALL
        SELECT revisions.id, revisions.parent_revision_id
        FROM t2k_reference.reconciliation_revisions AS revisions
        INNER JOIN ancestors
          ON revisions.id = ancestors.parent_revision_id
        WHERE revisions.canonical_object_id = NEW.canonical_object_id
      )
      SELECT EXISTS (
        SELECT 1
        FROM ancestors
        WHERE ancestors.id = NEW.activated_revision_id
          AND ancestors.id <> NEW.previous_revision_id
      ) INTO rollback_target_is_ancestor;
      IF NOT rollback_target_is_ancestor THEN
        RAISE EXCEPTION
          'rollback target must be a strict ancestor of the previous revision'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.activation_type = 'reactivation' THEN
      SELECT proposals.proposed_by_actor_id,
             dispositions.reviewed_by_actor_id,
             revisions.accepted_by_actor_id
        INTO target_proposer, target_reviewer, target_accepter
      FROM t2k_reference.reconciliation_revisions AS revisions
      INNER JOIN t2k_reference.reconciliation_proposals AS proposals
        ON proposals.id = revisions.proposal_id
      INNER JOIN t2k_reference.reconciliation_dispositions AS dispositions
        ON dispositions.id = revisions.approval_disposition_id
      WHERE revisions.id = NEW.activated_revision_id
        AND revisions.canonical_object_id = NEW.canonical_object_id;
      IF NOT FOUND OR NEW.activated_by_actor_id IN (
        target_proposer, target_reviewer, target_accepter
      ) THEN
        RAISE EXCEPTION
          'reactivation actor must be separate from the target revision governance actors'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION t2k_reference.assert_reconciliation_disposition_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  proposal_actor TEXT;
  required_role TEXT;
BEGIN
  SELECT proposals.proposed_by_actor_id, proposals.required_reviewer_role
    INTO proposal_actor, required_role
  FROM t2k_reference.reconciliation_proposals AS proposals
  WHERE proposals.id = NEW.proposal_id;

  IF NOT FOUND OR NEW.reviewed_by_actor_id = proposal_actor OR
     NEW.reviewer_role <> required_role THEN
    RAISE EXCEPTION
      'reconciliation disposition violates proposer separation or reviewer role'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_disposition_governed
  ON t2k_reference.reconciliation_dispositions;
CREATE CONSTRAINT TRIGGER t2k_reference_reconciliation_disposition_governed
AFTER INSERT ON t2k_reference.reconciliation_dispositions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION t2k_reference.assert_reconciliation_disposition_governance();

CREATE OR REPLACE FUNCTION t2k_reference.assert_reconciliation_revision_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  approval_decision TEXT;
  proposal_base_revision UUID;
  proposal_content JSONB;
  proposal_content_hash TEXT;
  proposal_actor TEXT;
  review_actor TEXT;
BEGIN
  SELECT dispositions.decision, proposals.base_revision_id,
         proposals.proposed_content, proposals.content_hash,
         proposals.proposed_by_actor_id, dispositions.reviewed_by_actor_id
    INTO approval_decision, proposal_base_revision, proposal_content,
         proposal_content_hash, proposal_actor, review_actor
  FROM t2k_reference.reconciliation_dispositions AS dispositions
  INNER JOIN t2k_reference.reconciliation_proposals AS proposals
    ON proposals.id = dispositions.proposal_id
  WHERE dispositions.id = NEW.approval_disposition_id
    AND dispositions.proposal_id = NEW.proposal_id;

  IF NOT FOUND OR approval_decision <> 'approved' THEN
    RAISE EXCEPTION
      'canonical reconciliation revisions require an approved disposition'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_revision_id IS DISTINCT FROM proposal_base_revision OR
     NEW.content IS DISTINCT FROM proposal_content OR
     NEW.content_hash <> proposal_content_hash THEN
    RAISE EXCEPTION
      'canonical revision must exactly match its approved proposal and base revision'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.accepted_by_actor_id IN (proposal_actor, review_actor) THEN
    RAISE EXCEPTION
      'canonical revision accepter must be separate from proposer and reviewer'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_revision_approved
  ON t2k_reference.reconciliation_revisions;
CREATE CONSTRAINT TRIGGER t2k_reference_reconciliation_revision_approved
AFTER INSERT ON t2k_reference.reconciliation_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION t2k_reference.assert_reconciliation_revision_approval();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_object_active_matches
  ON t2k_reference.reconciliation_objects;
CREATE CONSTRAINT TRIGGER t2k_reference_reconciliation_object_active_matches
AFTER INSERT OR UPDATE ON t2k_reference.reconciliation_objects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION t2k_reference.assert_reconciliation_object_active();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_activation_active_matches
  ON t2k_reference.reconciliation_activations;
CREATE CONSTRAINT TRIGGER t2k_reference_reconciliation_activation_active_matches
AFTER INSERT ON t2k_reference.reconciliation_activations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION t2k_reference.assert_reconciliation_activation_active();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_proposals_append_only
  ON t2k_reference.reconciliation_proposals;
CREATE TRIGGER t2k_reference_reconciliation_proposals_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_proposals
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_proposals_no_truncate
  ON t2k_reference.reconciliation_proposals;
CREATE TRIGGER t2k_reference_reconciliation_proposals_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_proposals
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_receipts_append_only
  ON t2k_reference.reconciliation_proposal_receipts;
CREATE TRIGGER t2k_reference_reconciliation_receipts_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_proposal_receipts
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_receipts_no_truncate
  ON t2k_reference.reconciliation_proposal_receipts;
CREATE TRIGGER t2k_reference_reconciliation_receipts_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_proposal_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_dispositions_append_only
  ON t2k_reference.reconciliation_dispositions;
CREATE TRIGGER t2k_reference_reconciliation_dispositions_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_dispositions
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_dispositions_no_truncate
  ON t2k_reference.reconciliation_dispositions;
CREATE TRIGGER t2k_reference_reconciliation_dispositions_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_dispositions
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_revisions_append_only
  ON t2k_reference.reconciliation_revisions;
CREATE TRIGGER t2k_reference_reconciliation_revisions_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_revisions
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_revisions_no_truncate
  ON t2k_reference.reconciliation_revisions;
CREATE TRIGGER t2k_reference_reconciliation_revisions_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_revisions
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_activations_append_only
  ON t2k_reference.reconciliation_activations;
CREATE TRIGGER t2k_reference_reconciliation_activations_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.reconciliation_activations
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_reconciliation_activations_no_truncate
  ON t2k_reference.reconciliation_activations;
CREATE TRIGGER t2k_reference_reconciliation_activations_no_truncate
BEFORE TRUNCATE ON t2k_reference.reconciliation_activations
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_execution_receipts_append_only
  ON t2k_reference.execution_receipts;
CREATE TRIGGER t2k_reference_execution_receipts_append_only
BEFORE UPDATE OR DELETE ON t2k_reference.execution_receipts
FOR EACH ROW EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DROP TRIGGER IF EXISTS t2k_reference_execution_receipts_no_truncate
  ON t2k_reference.execution_receipts;
CREATE TRIGGER t2k_reference_execution_receipts_no_truncate
BEFORE TRUNCATE ON t2k_reference.execution_receipts
FOR EACH STATEMENT
EXECUTE FUNCTION t2k_reference.prevent_reconciliation_history_mutation();

DO $$
DECLARE
  missing_constraints TEXT;
  missing_indexes TEXT;
  missing_triggers TEXT;
BEGIN
  WITH required(relation_name, constraint_name) AS (
    VALUES
      ('reconciliation_objects',
       't2k_reference_reconciliation_object_id_identity_uq'),
      ('reconciliation_objects',
       't2k_reference_reconciliation_active_revision_fk'),
      ('reconciliation_proposals',
       't2k_reference_reconciliation_proposal_object_fk'),
      ('reconciliation_proposals',
       't2k_reference_reconciliation_proposal_id_object_uq'),
      ('reconciliation_proposals',
       't2k_reference_reconciliation_proposal_base_uq'),
      ('reconciliation_proposals',
       't2k_reference_reconciliation_base_revision_fk'),
      ('reconciliation_proposal_receipts',
       't2k_reference_reconciliation_receipt_execution_fk'),
      ('reconciliation_dispositions',
       't2k_reference_reconciliation_disposition_id_proposal_uq'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revision_parent_object_fk'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revision_proposal_object_fk'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revision_proposal_base_fk'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revision_disposition_proposal_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_target_object_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_previous_object_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_proposal_object_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_disposition_proposal_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_revision_lineage_fk'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_parent_lineage_fk')
  )
  SELECT STRING_AGG(
           required.relation_name || '.' || required.constraint_name,
           ', ' ORDER BY required.relation_name, required.constraint_name
         )
    INTO missing_constraints
  FROM required
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS relations
      ON relations.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE namespaces.nspname = 't2k_reference'
      AND relations.relname = required.relation_name
      AND constraints.conname = required.constraint_name
  );

  IF missing_constraints IS NOT NULL THEN
    RAISE EXCEPTION
      'reference schema v2 is missing required constraints: %',
      missing_constraints;
  END IF;

  WITH required(index_name, column_name) AS (
    VALUES
      ('t2k_reference_reconciliation_acceptance_revision_uq',
       'activated_revision_id'),
      ('t2k_reference_reconciliation_acceptance_proposal_uq',
       'source_proposal_id')
  )
  SELECT STRING_AGG(required.index_name, ', ' ORDER BY required.index_name)
    INTO missing_indexes
  FROM required
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index AS indexes
    INNER JOIN pg_class AS index_relations
      ON index_relations.oid = indexes.indexrelid
    INNER JOIN pg_class AS table_relations
      ON table_relations.oid = indexes.indrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = table_relations.relnamespace
    INNER JOIN pg_attribute AS attributes
      ON attributes.attrelid = table_relations.oid
     AND attributes.attname = required.column_name
    WHERE namespaces.nspname = 't2k_reference'
      AND table_relations.relname = 'reconciliation_activations'
      AND index_relations.relname = required.index_name
      AND indexes.indisunique
      AND indexes.indnkeyatts = 1
      AND indexes.indkey::TEXT = attributes.attnum::TEXT
      AND pg_get_expr(indexes.indpred, indexes.indrelid) =
            '(activation_type = ''acceptance''::text)'
  );

  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION
      'reference schema v2 is missing required indexes: %',
      missing_indexes;
  END IF;

  WITH required(relation_name, trigger_name) AS (
    VALUES
      ('reconciliation_objects',
       't2k_reference_reconciliation_objects_identity_immutable'),
      ('reconciliation_objects',
       't2k_reference_reconciliation_object_active_matches'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activation_active_matches'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revision_approved'),
      ('reconciliation_dispositions',
       't2k_reference_reconciliation_disposition_governed'),
      ('reconciliation_proposals',
       't2k_reference_reconciliation_proposals_no_truncate'),
      ('reconciliation_proposal_receipts',
       't2k_reference_reconciliation_receipts_no_truncate'),
      ('reconciliation_dispositions',
       't2k_reference_reconciliation_dispositions_no_truncate'),
      ('reconciliation_revisions',
       't2k_reference_reconciliation_revisions_no_truncate'),
      ('reconciliation_activations',
       't2k_reference_reconciliation_activations_no_truncate'),
      ('execution_receipts',
       't2k_reference_execution_receipts_append_only'),
      ('execution_receipts',
       't2k_reference_execution_receipts_no_truncate')
  )
  SELECT STRING_AGG(
           required.relation_name || '.' || required.trigger_name,
           ', ' ORDER BY required.relation_name, required.trigger_name
         )
    INTO missing_triggers
  FROM required
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS triggers
    INNER JOIN pg_class AS relations
      ON relations.oid = triggers.tgrelid
    INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = relations.relnamespace
    WHERE namespaces.nspname = 't2k_reference'
      AND relations.relname = required.relation_name
      AND triggers.tgname = required.trigger_name
      AND NOT triggers.tgisinternal
  );

  IF missing_triggers IS NOT NULL THEN
    RAISE EXCEPTION
      'reference schema v2 is missing required triggers: %',
      missing_triggers;
  END IF;
END $$;

INSERT INTO t2k_reference.schema_migrations(version)
VALUES (${REFERENCE_LIFECYCLE_SCHEMA_VERSION})
ON CONFLICT (version) DO NOTHING;
`;

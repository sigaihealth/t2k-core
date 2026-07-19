export const REFERENCE_LIFECYCLE_SCHEMA_VERSION = 1;

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
    SELECT 1 FROM pg_constraint
    WHERE conname = 't2k_reference_active_policy_version_fk'
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

INSERT INTO t2k_reference.schema_migrations(version)
VALUES (${REFERENCE_LIFECYCLE_SCHEMA_VERSION})
ON CONFLICT (version) DO NOTHING;
`;

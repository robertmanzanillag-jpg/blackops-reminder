-- AI Media Studio PR5 governance and quality evidence: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_influencers', 'ai_media_provider_resources', 'ai_media_render_jobs', 'ai_media_assets'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR5 governance requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

-- Composite candidate keys make every governance reference tenant-safe instead
-- of trusting an application-side owner/workspace predicate.
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_influencers_owner_workspace_id_uq
  ON ai_media_influencers (owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_resources_owner_workspace_id_uq
  ON ai_media_provider_resources (owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_id_uq
  ON ai_media_assets (owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_id_checksum_uq
  ON ai_media_assets (owner_user_id, workspace_id, id, checksum);

CREATE TABLE IF NOT EXISTS ai_media_governance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  influencer_id uuid NOT NULL,
  avatar_resource_id uuid NOT NULL,
  voice_resource_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active',
  consent_basis text NOT NULL,
  rights_basis text NOT NULL,
  allowed_uses jsonb NOT NULL,
  territories jsonb NOT NULL,
  proof_digest text NOT NULL,
  evidence_digest text NOT NULL,
  brand_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  policy_version text NOT NULL,
  actor_user_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  previous_profile_id uuid,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_governance_profiles_owner_workspace_id_uq
    UNIQUE (owner_user_id, workspace_id, id),
  CONSTRAINT ai_media_governance_profiles_influencer_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, influencer_id)
    REFERENCES ai_media_influencers (owner_user_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_media_governance_profiles_avatar_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, avatar_resource_id)
    REFERENCES ai_media_provider_resources (owner_user_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_media_governance_profiles_voice_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, voice_resource_id)
    REFERENCES ai_media_provider_resources (owner_user_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_media_governance_profiles_previous_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, previous_profile_id)
    REFERENCES ai_media_governance_profiles (owner_user_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_media_governance_profiles_state_ck
    CHECK (state IN ('active', 'revoked')),
  CONSTRAINT ai_media_governance_profiles_basis_ck
    CHECK (
      consent_basis IN ('obtained', 'synthetic_not_applicable')
      AND rights_basis IN ('owned', 'licensed')
    ),
  CONSTRAINT ai_media_governance_profiles_evidence_ck
    CHECK (
      proof_digest ~ '^sha256:[0-9a-f]{64}$'
      AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
      AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    ),
  CONSTRAINT ai_media_governance_profiles_document_shape_ck
    CHECK (
      jsonb_typeof(allowed_uses) = 'array' AND jsonb_array_length(allowed_uses) > 0
      AND allowed_uses <@ '["internal_preview", "organic_social", "paid_ads", "commercial"]'::jsonb
      AND jsonb_typeof(territories) = 'array' AND jsonb_array_length(territories) > 0
      AND jsonb_typeof(brand_policy) = 'object'
    ),
  CONSTRAINT ai_media_governance_profiles_revision_ck
    CHECK (
      version > 0
      AND length(btrim(policy_version)) BETWEEN 1 AND 64
      AND length(btrim(actor_user_id)) > 0
      AND length(btrim(idempotency_key)) > 0
      AND expires_at > valid_from
      AND previous_profile_id IS DISTINCT FROM id
      AND (
        (state = 'revoked' AND revoked_at IS NOT NULL
          AND length(btrim(revocation_reason)) BETWEEN 1 AND 500)
        OR (state = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL)
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_governance_profiles_owner_workspace_idempotency_uq
  ON ai_media_governance_profiles (owner_user_id, workspace_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_governance_profiles_owner_workspace_influencer_version_uq
  ON ai_media_governance_profiles (owner_user_id, workspace_id, influencer_id, version);
CREATE INDEX IF NOT EXISTS ai_media_governance_profiles_owner_workspace_state_expiry_idx
  ON ai_media_governance_profiles (owner_user_id, workspace_id, state, expires_at);
CREATE INDEX IF NOT EXISTS ai_media_governance_profiles_previous_profile_idx
  ON ai_media_governance_profiles (previous_profile_id);

CREATE TABLE IF NOT EXISTS ai_media_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  media_asset_id uuid NOT NULL,
  asset_checksum text NOT NULL,
  evaluator_type text NOT NULL DEFAULT 'human',
  decision text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  criteria jsonb NOT NULL,
  notes text,
  evidence_digest text NOT NULL,
  actor_user_id text NOT NULL,
  previous_review_id uuid,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_quality_reviews_owner_workspace_id_uq
    UNIQUE (owner_user_id, workspace_id, id),
  CONSTRAINT ai_media_quality_reviews_asset_checksum_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, media_asset_id, asset_checksum)
    REFERENCES ai_media_assets (owner_user_id, workspace_id, id, checksum) ON DELETE RESTRICT,
  CONSTRAINT ai_media_quality_reviews_previous_tenant_fk
    FOREIGN KEY (owner_user_id, workspace_id, previous_review_id)
    REFERENCES ai_media_quality_reviews (owner_user_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT ai_media_quality_reviews_evaluator_type_ck
    CHECK (evaluator_type = 'human'),
  CONSTRAINT ai_media_quality_reviews_decision_ck
    CHECK (decision IN ('approved', 'rejected', 'needs_review')),
  CONSTRAINT ai_media_quality_reviews_evidence_ck
    CHECK (
      asset_checksum ~ '^[0-9a-f]{64}$'
      AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
      AND input_digest ~ '^sha256:[0-9a-f]{64}$'
      AND length(btrim(actor_user_id)) > 0
      AND length(btrim(idempotency_key)) > 0
    ),
  CONSTRAINT ai_media_quality_reviews_criteria_shape_ck
    CHECK (
      CASE
        WHEN jsonb_typeof(criteria) = 'object'
          AND criteria ?& ARRAY['naturalMovement', 'eyeContact', 'speechQuality', 'lighting', 'realism', 'brandConsistency', 'verticalQuality']
          AND (criteria - 'naturalMovement' - 'eyeContact' - 'speechQuality' - 'lighting' - 'realism' - 'brandConsistency' - 'verticalQuality') = '{}'::jsonb
          AND jsonb_typeof(criteria->'naturalMovement') = 'number'
          AND jsonb_typeof(criteria->'eyeContact') = 'number'
          AND jsonb_typeof(criteria->'speechQuality') = 'number'
          AND jsonb_typeof(criteria->'lighting') = 'number'
          AND jsonb_typeof(criteria->'realism') = 'number'
          AND jsonb_typeof(criteria->'brandConsistency') = 'number'
          AND jsonb_typeof(criteria->'verticalQuality') = 'number'
          AND (criteria->>'naturalMovement') ~ '^[1-5]$'
          AND (criteria->>'eyeContact') ~ '^[1-5]$'
          AND (criteria->>'speechQuality') ~ '^[1-5]$'
          AND (criteria->>'lighting') ~ '^[1-5]$'
          AND (criteria->>'realism') ~ '^[1-5]$'
          AND (criteria->>'brandConsistency') ~ '^[1-5]$'
          AND (criteria->>'verticalQuality') ~ '^[1-5]$'
        THEN CASE
          WHEN (criteria->>'naturalMovement')::integer <= 2
            OR (criteria->>'eyeContact')::integer <= 2
            OR (criteria->>'speechQuality')::integer <= 2
            OR (criteria->>'lighting')::integer <= 2
            OR (criteria->>'realism')::integer <= 2
            OR (criteria->>'brandConsistency')::integer <= 2
            OR (criteria->>'verticalQuality')::integer <= 2
            THEN decision = 'rejected'
          WHEN (criteria->>'naturalMovement')::integer >= 4
            AND (criteria->>'eyeContact')::integer >= 4
            AND (criteria->>'speechQuality')::integer >= 4
            AND (criteria->>'lighting')::integer >= 4
            AND (criteria->>'realism')::integer >= 4
            AND (criteria->>'brandConsistency')::integer >= 4
            AND (criteria->>'verticalQuality')::integer >= 4
            THEN decision = 'approved'
          ELSE decision = 'needs_review'
        END
        ELSE false
      END
      AND (notes IS NULL OR length(notes) <= 2000)
    ),
  CONSTRAINT ai_media_quality_reviews_revision_ck
    CHECK (version > 0 AND previous_review_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_quality_reviews_owner_workspace_idempotency_uq
  ON ai_media_quality_reviews (owner_user_id, workspace_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_quality_reviews_owner_workspace_asset_version_uq
  ON ai_media_quality_reviews (owner_user_id, workspace_id, media_asset_id, version);
CREATE INDEX IF NOT EXISTS ai_media_quality_reviews_owner_workspace_asset_created_idx
  ON ai_media_quality_reviews (owner_user_id, workspace_id, media_asset_id, created_at);
CREATE INDEX IF NOT EXISTS ai_media_quality_reviews_owner_workspace_decision_created_idx
  ON ai_media_quality_reviews (owner_user_id, workspace_id, decision, created_at);
CREATE INDEX IF NOT EXISTS ai_media_quality_reviews_previous_review_idx
  ON ai_media_quality_reviews (previous_review_id);

ALTER TABLE ai_media_render_jobs
  ADD COLUMN IF NOT EXISTS governance_profile_id uuid,
  ADD COLUMN IF NOT EXISTS governance_evidence_digest text;

DO $render_governance_constraints$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_render_jobs jobs
    LEFT JOIN ai_media_governance_profiles profiles
      ON profiles.owner_user_id = jobs.owner_user_id
      AND profiles.workspace_id = jobs.workspace_id
      AND profiles.id = jobs.governance_profile_id
    WHERE jobs.governance_profile_id IS NOT NULL AND profiles.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned or cross-tenant render governance profiles block PR5';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_media_render_jobs
    WHERE (governance_profile_id IS NULL) <> (governance_evidence_digest IS NULL)
      OR (governance_evidence_digest IS NOT NULL
        AND governance_evidence_digest !~ '^sha256:[0-9a-f]{64}$')
  ) THEN
    RAISE EXCEPTION 'incomplete or invalid render governance snapshots block PR5';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_render_jobs_governance_profile_tenant_fk'
      AND conrelid = 'public.ai_media_render_jobs'::regclass
  ) THEN
    ALTER TABLE ai_media_render_jobs
      ADD CONSTRAINT ai_media_render_jobs_governance_profile_tenant_fk
      FOREIGN KEY (owner_user_id, workspace_id, governance_profile_id)
      REFERENCES ai_media_governance_profiles (owner_user_id, workspace_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_render_jobs_governance_evidence_ck'
      AND conrelid = 'public.ai_media_render_jobs'::regclass
  ) THEN
    ALTER TABLE ai_media_render_jobs
      ADD CONSTRAINT ai_media_render_jobs_governance_evidence_ck
      CHECK (
        (governance_profile_id IS NULL AND governance_evidence_digest IS NULL)
        OR (governance_profile_id IS NOT NULL
          AND governance_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
      ) NOT VALID;
  END IF;
END;
$render_governance_constraints$;

ALTER TABLE ai_media_render_jobs
  VALIDATE CONSTRAINT ai_media_render_jobs_governance_profile_tenant_fk;
ALTER TABLE ai_media_render_jobs
  VALIDATE CONSTRAINT ai_media_render_jobs_governance_evidence_ck;
CREATE INDEX IF NOT EXISTS ai_media_render_jobs_governance_profile_idx
  ON ai_media_render_jobs (governance_profile_id);

COMMIT;

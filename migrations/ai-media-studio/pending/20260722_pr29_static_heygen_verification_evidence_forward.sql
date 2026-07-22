-- AI Media Studio PR29: immutable static HeyGen live-verification evidence.
-- Preparation only. Do not apply automatically and do not perform provider verification here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_static_credential_bindings') IS NULL
    OR to_regclass('public.ai_media_provider_resources') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='ai_media_provider_accounts_oauth_credential_provenance_ck'
        AND conrelid='public.ai_media_provider_accounts'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'PR29 static HeyGen verification evidence requires the complete PR28 schema';
  END IF;
  IF to_regclass('public.ai_media_static_heygen_verification_headers') IS NOT NULL
    OR to_regclass('public.ai_media_static_heygen_resource_verifications') IS NOT NULL THEN
    RAISE EXCEPTION 'PR29 static HeyGen verification evidence must be absent';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_provider_accounts, ai_media_provider_resources, ai_media_static_credential_bindings
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE ai_media_provider_accounts
  ADD COLUMN static_credential_verification_id uuid,
  ADD COLUMN static_credential_verification_digest text,
  ADD COLUMN static_credential_verified_at timestamptz,
  ADD COLUMN static_credential_verification_expires_at timestamptz;

ALTER TABLE ai_media_provider_resources
  ADD COLUMN verification_header_id uuid,
  ADD COLUMN verification_resource_evidence_id uuid,
  ADD COLUMN verification_evidence_digest text,
  ADD COLUMN verified_credential_version integer,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verification_expires_at timestamptz;

CREATE UNIQUE INDEX ai_media_static_credential_bindings_exact_version_uq
  ON ai_media_static_credential_bindings(
    owner_user_id,workspace_id,id,provider_account_id,provider_key,target_credential_version,request_digest);

ALTER TABLE ai_media_provider_resources
  ADD CONSTRAINT ai_media_provider_resources_account_tenant_provider_fk
  FOREIGN KEY (owner_user_id,workspace_id,provider_account_id,provider_key)
  REFERENCES ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key)
  ON UPDATE NO ACTION ON DELETE RESTRICT NOT VALID;
ALTER TABLE ai_media_provider_resources
  VALIDATE CONSTRAINT ai_media_provider_resources_account_tenant_provider_fk;

ALTER TABLE ai_media_provider_resources
  ADD CONSTRAINT ai_media_provider_resources_verification_pointer_ck CHECK (
    ((verification_header_id IS NULL)=(verification_resource_evidence_id IS NULL))
    AND ((verification_header_id IS NULL)=(verification_evidence_digest IS NULL))
    AND ((verification_header_id IS NULL)=(verified_credential_version IS NULL))
    AND ((verification_header_id IS NULL)=(verified_at IS NULL))
    AND ((verification_header_id IS NULL)=(verification_expires_at IS NULL))
    AND (verification_evidence_digest IS NULL OR verification_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (verified_credential_version IS NULL OR verified_credential_version>=1)
    AND (verification_expires_at IS NULL OR verification_expires_at>verified_at)
  ) NOT VALID;
ALTER TABLE ai_media_provider_resources
  VALIDATE CONSTRAINT ai_media_provider_resources_verification_pointer_ck;

CREATE TABLE ai_media_static_heygen_verification_headers (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  static_credential_binding_id uuid NOT NULL,
  provider_credential_version integer NOT NULL,
  credential_binding_request_digest text NOT NULL,
  daily_plan_id uuid NOT NULL,
  source_roster_key text NOT NULL,
  source_roster_digest text NOT NULL,
  plan_digest text NOT NULL,
  verification_state text NOT NULL,
  account_evidence_digest text NOT NULL,
  billing_model text NOT NULL,
  verification_request_digest text NOT NULL,
  evidence_digest text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_static_heygen_verification_headers_account_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key)
    REFERENCES ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_heygen_verification_headers_credential_exact_fk FOREIGN KEY
    (owner_user_id,workspace_id,static_credential_binding_id,provider_account_id,provider_key,
      provider_credential_version,credential_binding_request_digest)
    REFERENCES ai_media_static_credential_bindings(owner_user_id,workspace_id,id,provider_account_id,provider_key,
      target_credential_version,request_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_heygen_verification_headers_plan_exact_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_id,provider_account_id,provider_key,provider_credential_version,
      source_roster_key,source_roster_digest,plan_digest)
    REFERENCES ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,
      provider_credential_version,source_roster_key,source_roster_digest,plan_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_heygen_verification_headers_ck CHECK (
    provider_key='heygen'
    AND provider_credential_version>=1
    AND length(btrim(source_roster_key)) BETWEEN 1 AND 200
    AND source_roster_digest ~ '^sha256:[0-9a-f]{64}$'
    AND plan_digest ~ '^sha256:[0-9a-f]{64}$'
    AND verification_state='verified'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 255
    AND credential_binding_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND account_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(billing_model)) BETWEEN 1 AND 80
    AND verification_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND expires_at>observed_at
  )
);
CREATE UNIQUE INDEX ai_media_static_heygen_verification_headers_idempotency_uq
  ON ai_media_static_heygen_verification_headers(owner_user_id,workspace_id,provider_account_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_static_heygen_verification_headers_exact_identity_uq
  ON ai_media_static_heygen_verification_headers(
    owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version,evidence_digest);
CREATE UNIQUE INDEX ai_media_static_heygen_verification_headers_header_identity_uq
  ON ai_media_static_heygen_verification_headers(
    owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version);

CREATE TABLE ai_media_static_heygen_resource_verifications (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  verification_header_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  provider_resource_id uuid NOT NULL,
  resource_type text NOT NULL,
  provider_resource_external_id_digest text NOT NULL,
  avatar_look_id_digest text,
  avatar_look_status text,
  avatar_group_id_digest text,
  avatar_group_status text,
  avatar_group_consent_status text,
  avatar_engines_digest text,
  voice_id_digest text,
  language text,
  voice_support_digest text,
  resource_response_digest text NOT NULL,
  evidence_digest text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_static_heygen_resource_verifications_header_fk FOREIGN KEY
    (owner_user_id,workspace_id,verification_header_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_static_heygen_verification_headers(
      owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_heygen_resource_verifications_resource_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key,provider_resource_id)
    REFERENCES ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_heygen_resource_verifications_ck CHECK (
    provider_key='heygen'
    AND provider_credential_version>=1
    AND resource_type IN ('avatar','voice')
    AND provider_resource_external_id_digest ~ '^sha256:[0-9a-f]{64}$'
    AND resource_response_digest ~ '^sha256:[0-9a-f]{64}$'
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND expires_at>observed_at
    AND (
      (resource_type='avatar'
        AND avatar_look_id_digest=provider_resource_external_id_digest
        AND avatar_look_id_digest ~ '^sha256:[0-9a-f]{64}$'
        AND avatar_look_status='completed'
        AND avatar_group_id_digest ~ '^sha256:[0-9a-f]{64}$'
        AND avatar_group_id_digest<>avatar_look_id_digest
        AND avatar_group_status='completed'
        AND avatar_group_consent_status='approved'
        AND avatar_engines_digest ~ '^sha256:[0-9a-f]{64}$'
        AND voice_id_digest IS NULL AND language IS NULL AND voice_support_digest IS NULL)
      OR (resource_type='voice'
        AND voice_id_digest=provider_resource_external_id_digest
        AND voice_id_digest ~ '^sha256:[0-9a-f]{64}$'
        AND length(btrim(language)) BETWEEN 2 AND 40
        AND voice_support_digest ~ '^sha256:[0-9a-f]{64}$'
        AND avatar_look_id_digest IS NULL AND avatar_group_id_digest IS NULL
        AND avatar_look_status IS NULL AND avatar_group_status IS NULL
        AND avatar_group_consent_status IS NULL AND avatar_engines_digest IS NULL)
    )
  )
);
CREATE UNIQUE INDEX ai_media_static_heygen_resource_verifications_header_resource_uq
  ON ai_media_static_heygen_resource_verifications(
    owner_user_id,workspace_id,verification_header_id,provider_resource_id);
CREATE UNIQUE INDEX ai_media_static_heygen_resource_verifications_idempotency_uq
  ON ai_media_static_heygen_resource_verifications(owner_user_id,workspace_id,provider_account_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_static_heygen_resource_verifications_exact_identity_uq
  ON ai_media_static_heygen_resource_verifications(
    owner_user_id,workspace_id,id,verification_header_id,provider_resource_id,provider_credential_version,evidence_digest);

ALTER TABLE ai_media_provider_accounts
  ADD CONSTRAINT ai_media_provider_accounts_static_verification_fk FOREIGN KEY
    (owner_user_id,workspace_id,static_credential_verification_id,id,provider_key,credential_version,
      static_credential_verification_digest)
    REFERENCES ai_media_static_heygen_verification_headers(
      owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ai_media_provider_resources
  ADD CONSTRAINT ai_media_provider_resources_static_verification_fk FOREIGN KEY
    (owner_user_id,workspace_id,verification_resource_evidence_id,verification_header_id,id,
      verified_credential_version,verification_evidence_digest)
    REFERENCES ai_media_static_heygen_resource_verifications(
      owner_user_id,workspace_id,id,verification_header_id,provider_resource_id,provider_credential_version,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ai_media_static_heygen_evidence_append_only_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $append_only$
BEGIN
  RAISE EXCEPTION 'static HeyGen verification evidence is append-only';
END;
$append_only$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_evidence_append_only_v1() FROM PUBLIC;

CREATE TRIGGER ai_media_static_heygen_verification_headers_append_only
  BEFORE UPDATE OR DELETE ON ai_media_static_heygen_verification_headers
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1();
CREATE TRIGGER ai_media_static_heygen_verification_headers_truncate_guard
  BEFORE TRUNCATE ON ai_media_static_heygen_verification_headers
  FOR EACH STATEMENT EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1();
CREATE TRIGGER ai_media_static_heygen_resource_verifications_append_only
  BEFORE UPDATE OR DELETE ON ai_media_static_heygen_resource_verifications
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1();
CREATE TRIGGER ai_media_static_heygen_resource_verifications_truncate_guard
  BEFORE TRUNCATE ON ai_media_static_heygen_resource_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1();

CREATE FUNCTION ai_media_static_heygen_assert_account_graph_v1(
  p_owner_user_id text,p_workspace_id text,p_provider_account_id uuid
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $assert_account$
DECLARE
  account_row record;
  verified_count integer;
  total_slot_count integer;
  avatar_slot_count integer;
  avatar_video_pair_count integer;
  all_slots_blocked boolean;
  all_video_numbers_bounded boolean;
  every_avatar_has_ten boolean;
  missing_resource_count integer;
  extra_resource_count integer;
  sampled_at timestamptz := transaction_timestamp();
BEGIN
  SELECT * INTO account_row FROM public.ai_media_provider_accounts
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND id=p_provider_account_id AND provider_key='heygen';
  IF NOT FOUND OR account_row.credential_source<>'static_api_key' THEN RETURN; END IF;

  IF account_row.status='active' AND account_row.credential_status='active' THEN
    SELECT count(*) INTO verified_count
    FROM public.ai_media_static_heygen_verification_headers header
    JOIN public.ai_media_static_credential_bindings binding
      ON binding.owner_user_id=header.owner_user_id AND binding.workspace_id=header.workspace_id
      AND binding.id=header.static_credential_binding_id
      AND binding.provider_account_id=header.provider_account_id
      AND binding.provider_key=header.provider_key
      AND binding.target_credential_version=header.provider_credential_version
      AND binding.request_digest=header.credential_binding_request_digest
    WHERE header.owner_user_id=account_row.owner_user_id
      AND header.workspace_id=account_row.workspace_id
      AND header.id=account_row.static_credential_verification_id
      AND header.provider_account_id=account_row.id
      AND header.provider_key='heygen'
      AND header.provider_credential_version=account_row.credential_version
      AND header.verification_state='verified'
      AND header.evidence_digest=account_row.static_credential_verification_digest
      AND header.observed_at=account_row.static_credential_verified_at
      AND header.expires_at=account_row.static_credential_verification_expires_at
      AND header.expires_at>sampled_at
      AND binding.lifecycle_state='pending'
      AND binding.secret_ref=account_row.secret_ref
      AND binding.actor_user_id=account_row.credential_actor_user_id;
    IF verified_count<>1 THEN
      RAISE EXCEPTION 'active static HeyGen account lacks exact current verification evidence';
    END IF;
    WITH header AS (
      SELECT * FROM public.ai_media_static_heygen_verification_headers h
      WHERE h.owner_user_id=account_row.owner_user_id
        AND h.workspace_id=account_row.workspace_id
        AND h.id=account_row.static_credential_verification_id
        AND h.provider_account_id=account_row.id
        AND h.provider_key='heygen'
        AND h.provider_credential_version=account_row.credential_version
        AND h.verification_state='verified'
    ), exact_slots AS (
      SELECT slots.avatar_resource_id,slots.voice_resource_id,slots.video_number,slots.status
      FROM public.ai_media_daily_plan_slots slots JOIN header h ON h.daily_plan_id=slots.daily_plan_id
      WHERE slots.owner_user_id=h.owner_user_id AND slots.workspace_id=h.workspace_id
        AND slots.provider_account_id=h.provider_account_id AND slots.provider_key=h.provider_key
        AND slots.provider_credential_version=h.provider_credential_version
    ), per_avatar AS (
      SELECT avatar_resource_id,count(*)::integer AS slot_count,
        count(DISTINCT video_number)::integer AS video_count,
        min(video_number)::integer AS min_video,max(video_number)::integer AS max_video
      FROM exact_slots GROUP BY avatar_resource_id
    )
    SELECT count(*)::integer,count(DISTINCT avatar_resource_id)::integer,
      count(DISTINCT (avatar_resource_id,video_number))::integer,bool_and(status='blocked'),
      bool_and(video_number BETWEEN 1 AND 10),
      COALESCE((SELECT bool_and(slot_count=10 AND video_count=10 AND min_video=1 AND max_video=10)
        FROM per_avatar), false)
    INTO total_slot_count,avatar_slot_count,avatar_video_pair_count,all_slots_blocked,
      all_video_numbers_bounded,every_avatar_has_ten
    FROM exact_slots;
    IF total_slot_count NOT BETWEEN 50 AND 100
      OR avatar_slot_count NOT BETWEEN 5 AND 10
      OR avatar_video_pair_count<>total_slot_count
      OR all_slots_blocked IS DISTINCT FROM true
      OR all_video_numbers_bounded IS DISTINCT FROM true
      OR every_avatar_has_ten IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'active static HeyGen account requires 5-10 avatars with exactly 10 blocked videos each';
    END IF;
    WITH header AS (
      SELECT * FROM public.ai_media_static_heygen_verification_headers h
      WHERE h.owner_user_id=account_row.owner_user_id
        AND h.workspace_id=account_row.workspace_id
        AND h.id=account_row.static_credential_verification_id
        AND h.provider_account_id=account_row.id
        AND h.provider_key='heygen'
        AND h.provider_credential_version=account_row.credential_version
        AND h.verification_state='verified'
    ), slot_resources AS (
      SELECT DISTINCT slots.avatar_resource_id AS provider_resource_id
      FROM public.ai_media_daily_plan_slots slots JOIN header h ON h.daily_plan_id=slots.daily_plan_id
      WHERE slots.owner_user_id=h.owner_user_id AND slots.workspace_id=h.workspace_id
        AND slots.provider_account_id=h.provider_account_id AND slots.provider_key=h.provider_key
        AND slots.provider_credential_version=h.provider_credential_version
      UNION
      SELECT DISTINCT slots.voice_resource_id AS provider_resource_id
      FROM public.ai_media_daily_plan_slots slots JOIN header h ON h.daily_plan_id=slots.daily_plan_id
      WHERE slots.owner_user_id=h.owner_user_id AND slots.workspace_id=h.workspace_id
        AND slots.provider_account_id=h.provider_account_id AND slots.provider_key=h.provider_key
        AND slots.provider_credential_version=h.provider_credential_version
    )
    SELECT count(*) INTO missing_resource_count FROM slot_resources sr, header h
    WHERE NOT EXISTS (
      SELECT 1 FROM public.ai_media_static_heygen_resource_verifications evidence
      JOIN public.ai_media_provider_resources resource
        ON resource.owner_user_id=evidence.owner_user_id AND resource.workspace_id=evidence.workspace_id
        AND resource.provider_account_id=evidence.provider_account_id AND resource.provider_key=evidence.provider_key
        AND resource.id=evidence.provider_resource_id AND resource.resource_type=evidence.resource_type
      WHERE evidence.owner_user_id=h.owner_user_id
        AND evidence.workspace_id=h.workspace_id
        AND evidence.verification_header_id=h.id
        AND evidence.provider_account_id=h.provider_account_id
        AND evidence.provider_key=h.provider_key
        AND evidence.provider_credential_version=h.provider_credential_version
        AND evidence.provider_resource_id=sr.provider_resource_id
        AND evidence.expires_at>sampled_at
    );
    WITH header AS (
      SELECT * FROM public.ai_media_static_heygen_verification_headers h
      WHERE h.owner_user_id=account_row.owner_user_id
        AND h.workspace_id=account_row.workspace_id
        AND h.id=account_row.static_credential_verification_id
        AND h.provider_account_id=account_row.id
        AND h.provider_key='heygen'
        AND h.provider_credential_version=account_row.credential_version
        AND h.verification_state='verified'
    ), slot_resources AS (
      SELECT DISTINCT slots.avatar_resource_id AS provider_resource_id
      FROM public.ai_media_daily_plan_slots slots JOIN header h ON h.daily_plan_id=slots.daily_plan_id
      WHERE slots.owner_user_id=h.owner_user_id AND slots.workspace_id=h.workspace_id
        AND slots.provider_account_id=h.provider_account_id AND slots.provider_key=h.provider_key
        AND slots.provider_credential_version=h.provider_credential_version
      UNION
      SELECT DISTINCT slots.voice_resource_id AS provider_resource_id
      FROM public.ai_media_daily_plan_slots slots JOIN header h ON h.daily_plan_id=slots.daily_plan_id
      WHERE slots.owner_user_id=h.owner_user_id AND slots.workspace_id=h.workspace_id
        AND slots.provider_account_id=h.provider_account_id AND slots.provider_key=h.provider_key
        AND slots.provider_credential_version=h.provider_credential_version
    )
    SELECT count(*) INTO extra_resource_count
    FROM public.ai_media_static_heygen_resource_verifications evidence JOIN header h
      ON h.owner_user_id=evidence.owner_user_id AND h.workspace_id=evidence.workspace_id
      AND h.id=evidence.verification_header_id
    WHERE evidence.provider_account_id=h.provider_account_id
      AND evidence.provider_key=h.provider_key
      AND evidence.provider_credential_version=h.provider_credential_version
      AND NOT EXISTS (SELECT 1 FROM slot_resources sr WHERE sr.provider_resource_id=evidence.provider_resource_id);
    IF missing_resource_count<>0 OR extra_resource_count<>0 THEN
      RAISE EXCEPTION 'static HeyGen verification evidence must exactly cover the bound roster plan resources';
    END IF;
  ELSIF account_row.status='disconnected' AND account_row.credential_status='unverified' THEN
    IF account_row.static_credential_verification_id IS NOT NULL
      OR account_row.static_credential_verification_digest IS NOT NULL
      OR account_row.static_credential_verified_at IS NOT NULL
      OR account_row.static_credential_verification_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'unverified static HeyGen account cannot point at verification evidence';
    END IF;
  END IF;
END;
$assert_account$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_assert_account_graph_v1(text,text,uuid) FROM PUBLIC;

CREATE FUNCTION ai_media_static_heygen_validate_account_graph_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_account$
BEGIN
  PERFORM public.ai_media_static_heygen_assert_account_graph_v1(
    COALESCE(NEW.owner_user_id,OLD.owner_user_id),COALESCE(NEW.workspace_id,OLD.workspace_id),
    COALESCE(NEW.id,OLD.id));
  RETURN NULL;
END;
$validate_account$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_validate_account_graph_v1() FROM PUBLIC;

CREATE FUNCTION ai_media_static_heygen_assert_resource_graph_v1(
  p_owner_user_id text,p_workspace_id text,p_provider_account_id uuid,p_provider_resource_id uuid
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $assert_resource$
DECLARE resource_row record; account_row record; verified_count integer; sampled_at timestamptz := transaction_timestamp();
BEGIN
  SELECT * INTO resource_row FROM public.ai_media_provider_resources
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND provider_account_id=p_provider_account_id AND provider_key='heygen'
      AND id=p_provider_resource_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO account_row FROM public.ai_media_provider_accounts
    WHERE owner_user_id=resource_row.owner_user_id AND workspace_id=resource_row.workspace_id
      AND id=resource_row.provider_account_id AND provider_key='heygen';
  IF NOT FOUND OR account_row.credential_source<>'static_api_key'
    OR account_row.status<>'active' OR account_row.credential_status<>'active'
    OR resource_row.status<>'active' THEN RETURN; END IF;

  SELECT count(*) INTO verified_count
  FROM public.ai_media_static_heygen_resource_verifications resource_evidence
  JOIN public.ai_media_static_heygen_verification_headers header
    ON header.owner_user_id=resource_evidence.owner_user_id
    AND header.workspace_id=resource_evidence.workspace_id
    AND header.id=resource_evidence.verification_header_id
    AND header.provider_account_id=resource_evidence.provider_account_id
    AND header.provider_key=resource_evidence.provider_key
    AND header.provider_credential_version=resource_evidence.provider_credential_version
  WHERE resource_evidence.owner_user_id=resource_row.owner_user_id
    AND resource_evidence.workspace_id=resource_row.workspace_id
    AND resource_evidence.id=resource_row.verification_resource_evidence_id
    AND resource_evidence.verification_header_id=resource_row.verification_header_id
    AND resource_evidence.provider_account_id=resource_row.provider_account_id
    AND resource_evidence.provider_key='heygen'
    AND resource_evidence.provider_credential_version=resource_row.verified_credential_version
    AND resource_evidence.provider_credential_version=account_row.credential_version
    AND resource_evidence.provider_resource_id=resource_row.id
    AND resource_evidence.resource_type=resource_row.resource_type
    AND resource_evidence.evidence_digest=resource_row.verification_evidence_digest
    AND resource_evidence.observed_at=resource_row.verified_at
    AND resource_evidence.expires_at=resource_row.verification_expires_at
    AND resource_evidence.expires_at>sampled_at
    AND header.id=account_row.static_credential_verification_id
    AND header.evidence_digest=account_row.static_credential_verification_digest
    AND header.verification_state='verified';
  IF verified_count<>1 THEN
    RAISE EXCEPTION 'active static HeyGen resource lacks exact current resource verification evidence';
  END IF;
END;
$assert_resource$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_assert_resource_graph_v1(text,text,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ai_media_static_heygen_validate_resource_graph_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_resource$
BEGIN
  PERFORM public.ai_media_static_heygen_assert_resource_graph_v1(
    COALESCE(NEW.owner_user_id,OLD.owner_user_id),COALESCE(NEW.workspace_id,OLD.workspace_id),
    COALESCE(NEW.provider_account_id,OLD.provider_account_id),COALESCE(NEW.id,OLD.id));
  RETURN NULL;
END;
$validate_resource$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_validate_resource_graph_v1() FROM PUBLIC;

CREATE FUNCTION ai_media_static_heygen_validate_header_account_graph_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_header_account$
BEGIN
  PERFORM public.ai_media_static_heygen_assert_account_graph_v1(NEW.owner_user_id,NEW.workspace_id,NEW.provider_account_id);
  RETURN NULL;
END;
$validate_header_account$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_validate_header_account_graph_v1() FROM PUBLIC;

CREATE FUNCTION ai_media_static_heygen_validate_resource_evidence_graph_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_resource_evidence$
BEGIN
  PERFORM public.ai_media_static_heygen_assert_account_graph_v1(NEW.owner_user_id,NEW.workspace_id,NEW.provider_account_id);
  PERFORM public.ai_media_static_heygen_assert_resource_graph_v1(
    NEW.owner_user_id,NEW.workspace_id,NEW.provider_account_id,NEW.provider_resource_id);
  RETURN NULL;
END;
$validate_resource_evidence$;
REVOKE ALL ON FUNCTION ai_media_static_heygen_validate_resource_evidence_graph_v1() FROM PUBLIC;

ALTER TABLE ai_media_provider_accounts
  DROP CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;
ALTER TABLE ai_media_provider_accounts
  ADD CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck CHECK (
    (credential_source='not_bound' AND secret_ref IS NULL AND credential_version=0 AND credential_actor_user_id IS NULL
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL AND static_credential_verification_id IS NULL
      AND static_credential_verification_digest IS NULL AND static_credential_verified_at IS NULL
      AND static_credential_verification_expires_at IS NULL)
    OR (credential_source='legacy_authorized_unbound' AND credential_actor_user_id IS NULL
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL AND static_credential_verification_id IS NULL
      AND static_credential_verification_digest IS NULL AND static_credential_verified_at IS NULL
      AND static_credential_verification_expires_at IS NULL)
    OR (credential_source='oauth_authorization' AND status='active' AND credential_status='active'
      AND credential_version>0 AND credential_actor_user_id IS NOT NULL AND credential_source_session_id IS NOT NULL
      AND external_account_id IS NOT NULL AND length(btrim(external_account_id)) BETWEEN 1 AND 255
      AND secret_ref ~ '^vault://ai-media-studio/oauth-token/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND token_binding_id IS NOT NULL AND credential_binding_id IS NULL AND token_kind='Bearer'
      AND credential_expires_at IS NOT NULL AND capabilities @> '["publish_video"]'::jsonb
      AND jsonb_array_length(granted_scopes)>0 AND length(btrim(token_manifest_revision)) BETWEEN 1 AND 100
      AND static_credential_verification_id IS NULL AND static_credential_verification_digest IS NULL
      AND static_credential_verified_at IS NULL AND static_credential_verification_expires_at IS NULL)
    OR (credential_source='oauth_role_v2' AND status='active' AND credential_status='active'
      AND credential_version>0 AND credential_actor_user_id IS NOT NULL AND credential_source_session_id IS NOT NULL
      AND external_account_id IS NOT NULL AND length(btrim(external_account_id)) BETWEEN 1 AND 255
      AND secret_ref IS NULL AND token_binding_id IS NOT NULL AND credential_binding_id IS NOT NULL
      AND token_kind='role_v2' AND capabilities @> '["publish_video"]'::jsonb
      AND jsonb_array_length(granted_scopes)>0 AND length(btrim(token_manifest_revision)) BETWEEN 1 AND 100
      AND static_credential_verification_id IS NULL AND static_credential_verification_digest IS NULL
      AND static_credential_verified_at IS NULL AND static_credential_verification_expires_at IS NULL)
    OR (credential_source='static_api_key' AND provider_key='heygen' AND status='disconnected'
      AND credential_status='unverified' AND credential_version>0 AND credential_actor_user_id IS NOT NULL
      AND secret_ref ~ '^env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY(_[A-Z0-9]{1,32})?$'
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL AND external_account_id IS NULL
      AND credential_expires_at IS NULL AND credential_refresh_expires_at IS NULL
      AND credential_refreshed_at IS NULL AND last_verified_at IS NULL
      AND static_credential_verification_id IS NULL AND static_credential_verification_digest IS NULL
      AND static_credential_verified_at IS NULL AND static_credential_verification_expires_at IS NULL
      AND granted_scopes='[]'::jsonb AND capabilities='[]'::jsonb)
    OR (credential_source='static_api_key' AND provider_key='heygen' AND status='active'
      AND credential_status='active' AND credential_version>0 AND credential_actor_user_id IS NOT NULL
      AND secret_ref ~ '^env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY(_[A-Z0-9]{1,32})?$'
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL AND external_account_id IS NULL
      AND credential_expires_at IS NOT NULL AND credential_refresh_expires_at IS NULL
      AND credential_refreshed_at IS NULL AND last_verified_at IS NOT NULL
      AND static_credential_verification_id IS NOT NULL
      AND static_credential_verification_digest ~ '^sha256:[0-9a-f]{64}$'
      AND static_credential_verified_at=last_verified_at
      AND static_credential_verification_expires_at=credential_expires_at
      AND granted_scopes='[]'::jsonb
      AND capabilities='["render_video"]'::jsonb)
  ) NOT VALID;
ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;

CREATE CONSTRAINT TRIGGER ai_media_provider_accounts_static_heygen_verification_graph
  AFTER INSERT OR UPDATE OF credential_source,credential_version,secret_ref,credential_actor_user_id,status,
    credential_status,static_credential_verification_id,static_credential_verification_digest,
    static_credential_verified_at,static_credential_verification_expires_at,last_verified_at,credential_expires_at
  ON ai_media_provider_accounts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_validate_account_graph_v1();

CREATE CONSTRAINT TRIGGER ai_media_provider_resources_static_heygen_verification_graph
  AFTER INSERT OR UPDATE OF status,verification_header_id,verification_resource_evidence_id,
    verification_evidence_digest,verified_credential_version,verified_at,verification_expires_at
  ON ai_media_provider_resources DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_validate_resource_graph_v1();

CREATE CONSTRAINT TRIGGER ai_media_static_heygen_verification_headers_account_graph
  AFTER INSERT ON ai_media_static_heygen_verification_headers DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_validate_header_account_graph_v1();

CREATE CONSTRAINT TRIGGER ai_media_static_heygen_resource_verifications_resource_graph
  AFTER INSERT ON ai_media_static_heygen_resource_verifications DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_heygen_validate_resource_evidence_graph_v1();

COMMIT;

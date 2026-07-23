-- AI Media Studio PR33: exact one-video submit claim/authorization surface.
-- Review artifact only. Do not apply automatically.
-- PostgreSQL 16 only. This migration performs no provider, network, external-publication, or deploy I/O.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $preflight$
DECLARE role_row record;
BEGIN
  SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname='ai_media_one_video_run_executor';
  IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolinherit
    OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls
  THEN RAISE EXCEPTION 'PR33 requires safe precreated NOLOGIN NOINHERIT ai_media_one_video_run_executor'; END IF;
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_exact_one_video_run_capabilities') IS NULL
    OR to_regclass('public.ai_media_exact_one_video_run_fences') IS NULL
    OR to_regclass('public.ai_media_provider_submission_attempts') IS NULL
    OR to_regclass('public.ai_media_admitted_worker_capabilities') IS NULL
    OR to_regprocedure('ai_media_worker_api.require_capability_v1(uuid,text,text,text,text,text,integer,integer)') IS NULL
    OR to_regprocedure('ai_media_worker_api.authorize_admitted_v1(uuid,text,text,uuid,uuid,bigint,uuid,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_submit_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_submit_ambiguous_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.require_exact_one_video_submit_context_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.claim_exact_one_video_submit_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.authorize_exact_one_video_submit_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'PR33 requires exact PR26 and PR32 surfaces and an unused PR33 surface'; END IF;
END
$preflight$;

CREATE FUNCTION ai_media_worker_api.require_exact_one_video_submit_context_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_operation text,p_worker_id text DEFAULT NULL,p_lease_ms integer DEFAULT NULL
) RETURNS TABLE(capability_id uuid,accounting_time_zone text,admitted_actor_user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE submit_capability public.ai_media_admitted_worker_capabilities%ROWTYPE;
  run_row public.ai_media_exact_one_video_run_fences%ROWTYPE;
  authority record; sampled_at timestamptz:=pg_catalog.clock_timestamp(); matching_capabilities integer;
BEGIN
  IF p_operation NOT IN ('claim','authorize','record_submit_confirmed','record_submit_ambiguous')
    OR p_command_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_work_handoff_digest!~'^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid exact submit context'; END IF;
  IF pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_capabilities',
      'SELECT,INSERT,UPDATE,DELETE')
    OR pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_fences',
      'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'exact one-video submit executor must remain table-blind' USING ERRCODE='42501'; END IF;
  SELECT fence.* INTO run_row
  FROM public.ai_media_exact_one_video_run_fences fence
  JOIN public.ai_media_exact_one_video_run_capabilities exact_capability
    ON exact_capability.id=fence.capability_id
   AND exact_capability.database_principal=SESSION_USER
  WHERE fence.id=p_execution_id
    AND fence.owner_user_id=p_owner_user_id AND fence.workspace_id=p_workspace_id
    AND fence.actor_user_id=p_actor_user_id
    AND fence.budget_reservation_id=p_budget_reservation_id
    AND fence.render_job_id=p_render_job_id
    AND fence.daily_plan_slot_id=p_daily_plan_slot_id
    AND fence.slot_attempt=p_slot_attempt
    AND fence.work_handoff_digest=p_work_handoff_digest
    AND fence.action='activate_and_submit'
    AND fence.command_digest=p_command_digest
    AND fence.state='running'
    AND fence.fencing_token=p_run_fencing_token
    AND fence.lease_token=p_run_lease_token
    AND fence.lease_owner=p_actor_user_id
    AND fence.lease_expires_at>sampled_at
  FOR UPDATE OF fence,exact_capability;
  IF NOT FOUND THEN RAISE EXCEPTION 'live exact one-video submit execution denied' USING ERRCODE='42501'; END IF;

  SELECT pg_catalog.count(*) INTO matching_capabilities
  FROM public.ai_media_admitted_worker_capabilities capability
  WHERE capability.database_principal=SESSION_USER
    AND capability.owner_user_id=p_owner_user_id AND capability.workspace_id=p_workspace_id
    AND capability.lane='submit' AND p_operation=ANY(capability.allowed_operations)
    AND (p_worker_id IS NULL OR capability.worker_id=p_worker_id)
    AND (p_lease_ms IS NULL OR p_lease_ms BETWEEN 1 AND capability.max_lease_ms)
    AND capability.valid_from<=sampled_at AND capability.expires_at>sampled_at
    AND capability.revoked_at IS NULL;
  IF matching_capabilities<>1 THEN
    RAISE EXCEPTION 'exact submit requires exactly one live admitted capability' USING ERRCODE='42501';
  END IF;
  SELECT * INTO submit_capability
  FROM public.ai_media_admitted_worker_capabilities capability
  WHERE capability.database_principal=SESSION_USER
    AND capability.owner_user_id=p_owner_user_id AND capability.workspace_id=p_workspace_id
    AND capability.lane='submit' AND p_operation=ANY(capability.allowed_operations)
    AND (p_worker_id IS NULL OR capability.worker_id=p_worker_id)
    AND (p_lease_ms IS NULL OR p_lease_ms BETWEEN 1 AND capability.max_lease_ms)
    AND capability.valid_from<=sampled_at AND capability.expires_at>sampled_at
    AND capability.revoked_at IS NULL
  FOR UPDATE;
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(
    submit_capability.id,p_owner_user_id,p_workspace_id,'submit',p_operation,p_worker_id,p_lease_ms,NULL);
  RETURN QUERY SELECT submit_capability.id,authority.accounting_time_zone,authority.actor_user_id;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,lease_token uuid,lease_expires_at timestamptz,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE authority record; candidate record; attempt record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
  new_lease uuid:=pg_catalog.gen_random_uuid(); new_attempt uuid; v_event_kind text; event_digest text;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_exact_one_video_submit_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'claim',p_worker_id,p_lease_ms);
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  SELECT reservation.owner_user_id,reservation.workspace_id,activation.id work_activation_id,
    reservation.id budget_reservation_id,job.id render_job_id,outbox.id dispatch_outbox_id,
    slot.id daily_plan_slot_id,reservation.attempt slot_attempt,reservation.provider_account_id,
    reservation.provider_key,reservation.provider_credential_version,reservation.provider_idempotency_key,
    reservation.script_variant_checksum,reservation.authority_snapshot_id,reservation.authority_digest,
    job.launch_intent_id,job.launch_intent_digest,reservation.admission_digest,reservation.work_handoff_digest,
    job.sealed_request_digest,job.request request_json,avatar.external_resource_id avatar_external_resource_id,
    voice.external_resource_id voice_external_resource_id,existing.id existing_attempt_id
  INTO candidate
  FROM public.ai_media_render_jobs job
  JOIN public.ai_media_budget_reservations reservation ON reservation.id=p_budget_reservation_id
    AND reservation.id=job.budget_reservation_id
    AND reservation.owner_user_id=job.owner_user_id AND reservation.workspace_id=job.workspace_id
    AND reservation.render_job_id=p_render_job_id AND reservation.work_handoff_digest=p_work_handoff_digest
    AND reservation.daily_plan_slot_id=p_daily_plan_slot_id AND reservation.attempt=p_slot_attempt
  JOIN public.ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
    AND outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
    AND outbox.render_job_id=p_render_job_id AND outbox.budget_reservation_id=p_budget_reservation_id
    AND outbox.work_handoff_digest=p_work_handoff_digest AND outbox.sealed_request_digest=job.sealed_request_digest
  JOIN public.ai_media_daily_plan_slots slot ON slot.id=p_daily_plan_slot_id
    AND slot.id=reservation.daily_plan_slot_id
    AND slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
    AND slot.provider_account_id=reservation.provider_account_id AND slot.provider_key=reservation.provider_key
    AND slot.provider_credential_version=reservation.provider_credential_version
  JOIN public.ai_media_work_activations activation ON activation.budget_reservation_id=p_budget_reservation_id
    AND activation.owner_user_id=reservation.owner_user_id AND activation.workspace_id=reservation.workspace_id
    AND activation.render_job_id=p_render_job_id AND activation.dispatch_outbox_id=outbox.id
    AND activation.daily_plan_slot_id=p_daily_plan_slot_id AND activation.slot_attempt=p_slot_attempt
    AND activation.work_handoff_digest=p_work_handoff_digest
    AND activation.sealed_request_digest=job.sealed_request_digest
  JOIN public.ai_media_provider_resources avatar ON avatar.id=job.avatar_resource_id
    AND avatar.owner_user_id=job.owner_user_id AND avatar.workspace_id=job.workspace_id
    AND avatar.provider_account_id=reservation.provider_account_id AND avatar.provider_key=reservation.provider_key
    AND avatar.resource_type='avatar'
  JOIN public.ai_media_provider_resources voice ON voice.id=job.voice_resource_id
    AND voice.owner_user_id=job.owner_user_id AND voice.workspace_id=job.workspace_id
    AND voice.provider_account_id=reservation.provider_account_id AND voice.provider_key=reservation.provider_key
    AND voice.resource_type='voice'
  LEFT JOIN public.ai_media_provider_submission_attempts existing ON existing.budget_reservation_id=p_budget_reservation_id
    AND existing.owner_user_id=p_owner_user_id AND existing.workspace_id=p_workspace_id
  WHERE job.id=p_render_job_id AND job.owner_user_id=p_owner_user_id AND job.workspace_id=p_workspace_id
    AND job.daily_plan_slot_id=p_daily_plan_slot_id AND job.slot_attempt=p_slot_attempt
    AND job.work_handoff_digest=p_work_handoff_digest
    AND reservation.state='reserved' AND reservation.submission_state='not_started'
    AND reservation.expires_at>sampled_at AND reservation.quote_expires_at>sampled_at
    AND ((existing.id IS NULL AND job.stage='queued' AND outbox.status='pending')
      OR (existing.state='claimed' AND existing.lease_expires_at<=sampled_at
        AND existing.render_job_id=p_render_job_id AND existing.daily_plan_slot_id=p_daily_plan_slot_id
        AND existing.slot_attempt=p_slot_attempt AND existing.work_handoff_digest=p_work_handoff_digest
        AND job.stage='leased' AND outbox.status='leased'))
    AND slot.status='queued' AND avatar.status='active' AND voice.status='active'
  FOR UPDATE OF job,reservation,outbox,slot,activation,avatar,voice;
  IF NOT FOUND THEN RETURN; END IF;
  new_attempt=COALESCE(candidate.existing_attempt_id,pg_catalog.gen_random_uuid());
  INSERT INTO public.ai_media_provider_submission_attempts(
    id,owner_user_id,workspace_id,budget_reservation_id,work_activation_id,render_job_id,dispatch_outbox_id,
    daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,provider_credential_version,
    provider_idempotency_key,avatar_external_resource_id,voice_external_resource_id,script_variant_checksum,
    authority_snapshot_id,work_handoff_digest,sealed_request_digest,authority_digest,launch_intent_id,
    launch_intent_digest,admission_digest,state,fencing_token,claim_count,lease_token,lease_owner,
    lease_expires_at,claimed_at,actor_user_id,input_digest,created_at,updated_at)
  VALUES(new_attempt,p_owner_user_id,p_workspace_id,p_budget_reservation_id,candidate.work_activation_id,
    p_render_job_id,candidate.dispatch_outbox_id,p_daily_plan_slot_id,p_slot_attempt,candidate.provider_account_id,
    candidate.provider_key,candidate.provider_credential_version,candidate.provider_idempotency_key,
    candidate.avatar_external_resource_id,candidate.voice_external_resource_id,candidate.script_variant_checksum,
    candidate.authority_snapshot_id,p_work_handoff_digest,candidate.sealed_request_digest,
    candidate.authority_digest,candidate.launch_intent_id,candidate.launch_intent_digest,
    candidate.admission_digest,'claimed',1,1,new_lease,authority.admitted_actor_user_id,
    sampled_at+(p_lease_ms::text||' milliseconds')::interval,sampled_at,authority.admitted_actor_user_id,
    ai_media_worker_api.sha256_text_v1('claim:v1:'||new_attempt::text||':'||p_budget_reservation_id::text||
      ':'||authority.admitted_actor_user_id||':'||candidate.provider_idempotency_key||':'||
      candidate.sealed_request_digest),
    sampled_at,sampled_at)
  ON CONFLICT(owner_user_id,workspace_id,budget_reservation_id) DO UPDATE SET
    fencing_token=ai_media_provider_submission_attempts.fencing_token+1,
    claim_count=ai_media_provider_submission_attempts.claim_count+1,lease_token=EXCLUDED.lease_token,
    lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=EXCLUDED.updated_at
  WHERE ai_media_provider_submission_attempts.state='claimed'
    AND ai_media_provider_submission_attempts.render_job_id=p_render_job_id
    AND ai_media_provider_submission_attempts.daily_plan_slot_id=p_daily_plan_slot_id
    AND ai_media_provider_submission_attempts.slot_attempt=p_slot_attempt
    AND ai_media_provider_submission_attempts.work_handoff_digest=p_work_handoff_digest
    AND ai_media_provider_submission_attempts.lease_expires_at<=sampled_at
  RETURNING * INTO attempt;
  IF NOT FOUND THEN RETURN; END IF;
  v_event_kind=CASE WHEN attempt.claim_count=1 THEN 'claimed' ELSE 'reclaimed' END;
  event_digest=ai_media_worker_api.sha256_text_v1(v_event_kind||':v1:'||attempt.id::text||':'||
    attempt.fencing_token::text||':'||attempt.claim_count::text||':'||new_lease::text);
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,evidence_digest,actor_user_id,observed_at,created_at)
  SELECT p_owner_user_id,p_workspace_id,attempt.id,p_budget_reservation_id,
    COALESCE(pg_catalog.max(e.sequence),0)+1,v_event_kind,attempt.fencing_token,event_digest,
    authority.admitted_actor_user_id,sampled_at,sampled_at
  FROM public.ai_media_provider_submission_events e
  WHERE e.submission_attempt_id=attempt.id;
  UPDATE public.ai_media_render_jobs SET stage='leased',status='rendering',
    lease_owner=authority.admitted_actor_user_id,
    lease_token=new_lease,lease_expires_at=attempt.lease_expires_at,lease_fencing=attempt.fencing_token,updated_at=sampled_at
  WHERE id=p_render_job_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND budget_reservation_id=p_budget_reservation_id AND daily_plan_slot_id=p_daily_plan_slot_id
    AND slot_attempt=p_slot_attempt AND work_handoff_digest=p_work_handoff_digest
    AND stage IN ('queued','leased');
  IF NOT FOUND THEN RAISE EXCEPTION 'fenced exact render claim CAS failed'; END IF;
  UPDATE public.ai_media_outbox SET status='leased',attempts=GREATEST(attempts,1),locked_at=sampled_at,
    lease_owner=authority.admitted_actor_user_id,lease_expires_at=attempt.lease_expires_at,
    fencing_token=attempt.fencing_token,updated_at=sampled_at
  WHERE id=candidate.dispatch_outbox_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND budget_reservation_id=p_budget_reservation_id AND render_job_id=p_render_job_id
    AND work_handoff_digest=p_work_handoff_digest AND status IN ('pending','leased');
  IF NOT FOUND THEN RAISE EXCEPTION 'fenced exact outbox claim CAS failed'; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,attempt.id,attempt.provider_account_id,attempt.provider_key,
    attempt.provider_credential_version,attempt.provider_idempotency_key,attempt.avatar_external_resource_id,
    attempt.voice_external_resource_id,attempt.sealed_request_digest,attempt.fencing_token,
    attempt.lease_token,attempt.lease_expires_at,candidate.request_json;
END
$function$;

CREATE FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_submission_lease_token uuid,p_sealed_request_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,lease_token uuid,lease_expires_at timestamptz,
  send_authorization_digest text,commit_evidence_digest text,authorized_at timestamptz,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_submit_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'authorize',NULL,NULL);
  PERFORM 1 FROM public.ai_media_provider_submission_attempts attempt
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.actor_user_id=context.admitted_actor_user_id AND attempt.state='claimed'
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.lease_token=p_submission_lease_token
    AND attempt.lease_owner=context.admitted_actor_user_id
    AND attempt.sealed_request_digest=p_sealed_request_digest;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    authorized.owner_user_id,authorized.workspace_id,authorized.budget_reservation_id,
    authorized.render_job_id,p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,
    authorized.id,authorized.provider_account_id,authorized.provider_key,
    authorized.provider_credential_version,authorized.provider_idempotency_key,
    authorized.avatar_external_resource_id,authorized.voice_external_resource_id,
    authorized.sealed_request_digest,authorized.fencing_token,authorized.lease_token,
    authorized.lease_expires_at,authorized.send_authorization_digest,
    authorized.commit_evidence_digest,authorized.authorized_at,authorized.request_json
  FROM ai_media_worker_api.authorize_admitted_v1(context.capability_id,p_owner_user_id,p_workspace_id,
    p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,p_submission_lease_token,
    p_sealed_request_digest) authorized;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_authorization_digest text,
  p_submission_lease_token uuid,p_provider_job_id text,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_submit_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'record_submit_confirmed',NULL,NULL);
  PERFORM 1 FROM public.ai_media_provider_submission_attempts attempt
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.actor_user_id=context.admitted_actor_user_id AND attempt.state='authorized'
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.lease_token=p_submission_lease_token
    AND attempt.lease_owner=context.admitted_actor_user_id
    AND attempt.lease_expires_at>sampled_at
    AND attempt.send_authorization_digest=p_authorization_digest;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,
      p_actor_user_id,p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,
      p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,false;
    RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,
    p_actor_user_id,p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,
    p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.record_submit_confirmed_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,
    p_authorization_digest,p_submission_lease_token,p_provider_job_id,p_provider_request_id,
    p_evidence_digest) result;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_authorization_digest text,
  p_submission_lease_token uuid,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_submit_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'record_submit_ambiguous',NULL,NULL);
  PERFORM 1 FROM public.ai_media_provider_submission_attempts attempt
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.actor_user_id=context.admitted_actor_user_id AND attempt.state='authorized'
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.lease_token=p_submission_lease_token
    AND attempt.lease_owner=context.admitted_actor_user_id
    AND attempt.lease_expires_at>sampled_at
    AND attempt.send_authorization_digest=p_authorization_digest;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,
      p_actor_user_id,p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,
      p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,false;
    RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,
    p_actor_user_id,p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,
    p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.record_submit_ambiguous_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,
    p_authorization_digest,p_submission_lease_token,p_provider_request_id,p_evidence_digest) result;
END
$function$;

GRANT USAGE ON SCHEMA ai_media_worker_api TO ai_media_one_video_run_executor;
REVOKE ALL ON FUNCTION ai_media_worker_api.require_exact_one_video_submit_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text) FROM PUBLIC;

ALTER FUNCTION ai_media_worker_api.require_exact_one_video_submit_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,integer)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text)
  OWNER TO ai_media_admitted_fn_owner;

GRANT EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text)
  TO ai_media_one_video_run_executor;

COMMIT;

-- PR16B application rollback: preserve all PR16A evidence and remove only PR16B guards/helpers.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;
DROP TRIGGER IF EXISTS ai_media_oauth_vault_operations_v2_pr16b_cleanup_gate ON ai_media_oauth_vault_operations_v2;
DROP FUNCTION IF EXISTS ai_media_oauth_pr16b_cleanup_gate();
DROP TRIGGER IF EXISTS ai_media_oauth_target_selections_pr16b_owned ON ai_media_oauth_target_selections;
DROP FUNCTION IF EXISTS ai_media_oauth_pr16b_own_selection_evidence();
DROP FUNCTION IF EXISTS ai_media_oauth_pr16b_selection_digest(uuid,uuid,text,text,text,uuid,text,uuid,text,text,integer,timestamptz);
COMMIT;

-- Migration 007: fixes for the Supabase Security Advisor warnings.
-- Run AFTER 003_enable_rls.sql. Safe to run more than once.

-- "Function Search Path Mutable": pin each function to the public schema so
-- its table names can't be redirected to look-alike objects elsewhere.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('pull_pending_job', 'update_updated_at', 'get_campaign_job_counts',
                        'count_business_initiated_since', 'recently_contacted_phones')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END $$;

-- Only the backend (service_role key) calls these. Stop the public API keys
-- from calling them through /rest/v1/rpc.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('pull_pending_job', 'get_campaign_job_counts',
                        'count_business_initiated_since', 'recently_contacted_phones')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- "Unindexed foreign keys": deleting a message checks conversations.last_message_id.
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_id ON conversations(last_message_id);

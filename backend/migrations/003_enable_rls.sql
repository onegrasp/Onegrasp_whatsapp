-- Migration 003: Enable Row Level Security (RLS) on all application tables.
--
-- WHY: The backend talks to Supabase with a single server-side key. If that key
-- is the anon/publishable key and RLS is disabled (the default), the tables are
-- directly readable/writable by anyone who learns the project URL + anon key,
-- bypassing the Express auth layer entirely.
--
-- POSTURE: Enable RLS everywhere and add NO permissive policies. The backend
-- must use the SUPABASE service_role key, which bypasses RLS. The anon key then
-- has no access at all. Do not expose the service_role key to the browser.
--
-- Run this in the Supabase SQL editor after reviewing. It is idempotent.

ALTER TABLE IF EXISTS settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS opt_outs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS media_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs      ENABLE ROW LEVEL SECURITY;

-- Also force RLS for table owners, so even a mistakenly-owner connection is
-- subject to policies (service_role still bypasses RLS entirely).
ALTER TABLE IF EXISTS settings        FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS contacts        FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaigns       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages        FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversations   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS templates       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS jobs            FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS opt_outs        FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS media_assets    FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs      FORCE ROW LEVEL SECURITY;

-- The 'whatsapp-media' storage bucket is intentionally public-read (media URLs
-- are shared with WhatsApp). Keep write access restricted to the service role
-- via Supabase Storage policies; do not add a public INSERT/UPDATE policy.

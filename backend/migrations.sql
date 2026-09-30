-- WhatsApp Campaign Manager Database Migrations (KI-003, KI-004, KI-010, KI-013, KI-015)

-- 1. Standardize Phone Format
UPDATE contacts SET phone = '+' || phone WHERE phone NOT LIKE '+%';
UPDATE messages SET phone = '+' || phone WHERE phone NOT LIKE '+%';

CREATE TEMP TABLE conv_backup AS SELECT * FROM conversations;
DELETE FROM conversations;
INSERT INTO conversations (phone, contact_name, last_message, last_direction, last_status, last_timestamp, unread_count, created_at, updated_at)
SELECT '+' || phone, contact_name, last_message, last_direction, last_status, last_timestamp, unread_count, created_at, updated_at
FROM conv_backup WHERE phone NOT LIKE '+%';
INSERT INTO conversations (phone, contact_name, last_message, last_direction, last_status, last_timestamp, unread_count, created_at, updated_at)
SELECT phone, contact_name, last_message, last_direction, last_status, last_timestamp, unread_count, created_at, updated_at
FROM conv_backup WHERE phone LIKE '+%';
DROP TABLE conv_backup;

-- 2. Add Missing Indexes
CREATE INDEX IF NOT EXISTS idx_messages_phone_direction ON messages(phone, direction);
CREATE INDEX IF NOT EXISTS idx_messages_campaign_status ON messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_templates_content_sid ON templates(content_sid) WHERE content_sid != '';
CREATE INDEX IF NOT EXISTS idx_conversations_unread ON conversations(unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS idx_jobs_campaign_status ON jobs(campaign_id, status);

-- 3. Add updated_at Auto-Update Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS campaigns_updated_at ON campaigns;
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS messages_updated_at ON messages;
CREATE TRIGGER messages_updated_at BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS conversations_updated_at ON conversations;
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS templates_updated_at ON templates;
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS jobs_updated_at ON jobs;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 4. Create opt_outs Table
CREATE TABLE IF NOT EXISTS opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  reason TEXT DEFAULT 'user_requested',
  opted_out_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opt_outs_phone ON opt_outs(phone);

-- 5. Create media_assets Table
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Create audit_logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  performed_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 7. Add last_message_id and contacts FK
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS fk_conversations_contacts;
ALTER TABLE conversations ADD CONSTRAINT fk_conversations_contacts FOREIGN KEY (phone) REFERENCES contacts(phone) ON DELETE CASCADE;

-- 8. Add soft-delete Support Columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 9. Allow Jobs campaign_id to be Nullable
ALTER TABLE jobs ALTER COLUMN campaign_id DROP NOT NULL;

-- 10. Single-query Campaign Counts RPC
CREATE OR REPLACE FUNCTION get_campaign_job_counts(campaign_uuid UUID)
RETURNS TABLE(status TEXT, count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT j.status, COUNT(*)
  FROM jobs j
  WHERE j.campaign_id = campaign_uuid
  GROUP BY j.status;
END;
$$ LANGUAGE plpgsql;

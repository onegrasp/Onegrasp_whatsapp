-- 1. Create Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  label TEXT DEFAULT 'none',
  tags TEXT[] DEFAULT '{}'::TEXT[],
  is_active BOOLEAN DEFAULT true,
  is_important BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

-- 3. Create Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  message TEXT DEFAULT '',
  template_name TEXT DEFAULT '',
  type TEXT DEFAULT 'template',
  total_contacts INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Create Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  type TEXT DEFAULT 'text',
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT UNIQUE,
  template_name TEXT DEFAULT '',
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  error_details TEXT DEFAULT '',
  error_category TEXT DEFAULT '',
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

-- 5. Create Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  phone TEXT PRIMARY KEY,
  contact_name TEXT DEFAULT '',
  last_message TEXT DEFAULT '',
  last_direction TEXT DEFAULT 'incoming',
  last_status TEXT DEFAULT '',
  last_timestamp TIMESTAMPTZ DEFAULT now(),
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(last_timestamp DESC);

-- 6. Create Templates table
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  content_sid TEXT DEFAULT '',
  body TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  buttons JSONB DEFAULT '[]'::JSONB,
  list_items JSONB DEFAULT '[]'::JSONB,
  variables TEXT[] DEFAULT '{}'::TEXT[],
  category TEXT DEFAULT 'UTILITY',
  language TEXT DEFAULT 'en',
  status TEXT DEFAULT 'draft',
  rejection_reason TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Create Jobs table (Background worker queue)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  type TEXT NOT NULL,
  template_name TEXT DEFAULT '',
  message TEXT DEFAULT '',
  params TEXT[] DEFAULT '{}'::TEXT[],
  media_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error TEXT DEFAULT '',
  run_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON jobs(status, run_at);

-- 8. Create Atomic Pull pending job RPC (Skip Locked for concurrency safety)
CREATE OR REPLACE FUNCTION pull_pending_job()
RETURNS SETOF jobs AS $$
DECLARE
  selected_job jobs;
BEGIN
  SELECT * INTO selected_job
  FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF selected_job.id IS NOT NULL THEN
    UPDATE jobs
    SET status = 'processing', updated_at = now()
    WHERE id = selected_job.id;
    
    RETURN NEXT selected_job;
  END IF;
END;
$$ LANGUAGE plpgsql;

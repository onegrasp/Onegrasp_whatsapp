-- 005: Compliance and deliverability safeguards. Safe to run more than once.
-- The app keeps working before this runs, but consent, "not on WhatsApp"
-- flags and pause reasons are only stored once these columns exist.

-- Consent record per contact: 'unknown' | 'opted_in' | 'opted_out'.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_status TEXT DEFAULT 'unknown';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_source TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;

-- Set when WhatsApp reports the number can't receive messages.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS invalid_reason TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS invalid_at TIMESTAMPTZ;

-- Why a campaign was paused or cancelled (manually or automatically).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status_reason TEXT DEFAULT '';

-- Existing opt-outs become visible as consent status.
UPDATE contacts SET consent_status = 'opted_out'
WHERE phone IN (SELECT phone FROM opt_outs) AND consent_status IS DISTINCT FROM 'opted_out';

CREATE INDEX IF NOT EXISTS idx_messages_phone_timestamp ON messages(phone, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_phone_status ON jobs(phone, status);

-- Approximate WhatsApp business-initiated conversations in a window: unique
-- recipients of template messages that weren't rejected.
CREATE OR REPLACE FUNCTION count_business_initiated_since(since TIMESTAMPTZ)
RETURNS BIGINT AS $$
  SELECT COUNT(DISTINCT phone)
  FROM messages
  WHERE direction = 'outgoing'
    AND type = 'template'
    AND timestamp >= since
    AND status NOT IN ('failed', 'undelivered');
$$ LANGUAGE sql STABLE;

-- Which of the given phones received a campaign message since a time.
CREATE OR REPLACE FUNCTION recently_contacted_phones(phone_list TEXT[], since TIMESTAMPTZ)
RETURNS TABLE(phone TEXT) AS $$
  SELECT DISTINCT m.phone
  FROM messages m
  WHERE m.phone = ANY(phone_list)
    AND m.direction = 'outgoing'
    AND m.campaign_id IS NOT NULL
    AND m.timestamp >= since
    AND m.status NOT IN ('failed', 'undelivered');
$$ LANGUAGE sql STABLE;

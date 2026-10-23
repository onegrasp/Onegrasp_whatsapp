-- 004: Store the image/media URL on sent messages so Chats can show it.
-- Safe to run more than once.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT '';

-- Auto-replies are queued as jobs without a campaign. migrations.sql already
-- relaxes this; repeated here in case that step was skipped on this database.
ALTER TABLE jobs ALTER COLUMN campaign_id DROP NOT NULL;

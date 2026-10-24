-- Migration 008: brings the schema in line with what the app already uses.
-- Safe to run more than once.

-- Image header for media templates. The app has written this column for a
-- while, but no earlier script created it, so fresh installs failed to save
-- templates with an image.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_image_url TEXT DEFAULT '';

-- Before sending a campaign message the worker checks that this campaign
-- hasn't already reached this number (so a retried job never sends twice).
CREATE INDEX IF NOT EXISTS idx_messages_campaign_phone ON messages(campaign_id, phone);

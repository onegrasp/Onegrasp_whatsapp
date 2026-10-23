-- 006: Lets an urgent campaign be sent during quiet hours ("Send now anyway").
-- Safe to run more than once. Without it the override still works, but is
-- forgotten if the server restarts mid-campaign.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ignore_quiet_hours BOOLEAN DEFAULT false;

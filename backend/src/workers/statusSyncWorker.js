const supabase = require("../config/supabase");
const { getTwilioClient } = require("../integrations/twilio/client");
const { mapStatus } = require("../integrations/twilio/status.service");
const { mapTwilioError } = require("../integrations/twilio/errors");
const whatsappService = require("../services/whatsappService");
const eventBus = require("../events/eventBus");
const logger = require("../utils/logger");

// Status webhooks can be lost: a signature misconfiguration rejects them, and a
// sleeping host (Render free tier) can miss them while it wakes up. This worker
// periodically asks Twilio for the real status of recent outgoing messages and
// feeds any change through the normal MessageStatusEvent path, so delivery
// ticks and campaign counts converge even without callbacks.

const INTERVAL_MS = 90 * 1000;
const BATCH_SIZE = 20;
const OPEN_LOOKBACK_HOURS = 48; // queued / sending / sent can still change
const DELIVERED_LOOKBACK_HOURS = 12; // delivered can still become read

let timer = null;
let running = false;

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const touch = (id) =>
  supabase.from("messages").update({ updated_at: new Date().toISOString() }).eq("id", id);

const syncBatch = async () => {
  if (!supabase.isConfigured) return 0;
  if ((await whatsappService.getActiveProvider()) !== "twilio") return 0;
  const client = await getTwilioClient();
  if (client.isSimulated) return 0;

  const { data: rows, error } = await supabase
    .from("messages")
    .select("id, phone, message_id, status")
    .eq("direction", "outgoing")
    .gte("timestamp", hoursAgo(OPEN_LOOKBACK_HOURS))
    .or(`status.in.(queued,accepted,sending,sent),and(status.eq.delivered,timestamp.gte.${hoursAgo(DELIVERED_LOOKBACK_HOURS)})`)
    .or("message_id.like.SM%,message_id.like.MM%")
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw error;

  let changed = 0;
  for (const row of rows || []) {
    try {
      const remote = await client.messages(row.message_id).fetch();
      const status = mapStatus(remote.status);
      if (status && status !== row.status) {
        let errorDetails = null;
        let errorCategory = null;
        if (remote.errorCode) {
          errorDetails = `Twilio Error ${remote.errorCode}: ${remote.errorMessage || ""}`.trim();
          errorCategory = mapTwilioError({ code: remote.errorCode, message: remote.errorMessage }).category;
        }
        eventBus.publish("MessageStatusEvent", {
          phone: row.phone,
          messageSid: row.message_id,
          status,
          errorDetails,
          errorCategory,
        });
        changed++;
      }
    } catch (err) {
      logger.debug(`Status sync could not fetch ${row.message_id}: ${err.message}`);
    }
    // Move the row to the back of the queue so other messages get checked next.
    await touch(row.id);
  }
  return changed;
};

const tick = async () => {
  if (running) return;
  running = true;
  try {
    const changed = await syncBatch();
    if (changed > 0) logger.info(`Status sync reconciled ${changed} message status(es) from Twilio.`);
  } catch (err) {
    logger.warn("Status sync run failed", { error: err });
  } finally {
    running = false;
  }
};

const start = () => {
  if (timer) return;
  timer = setInterval(tick, INTERVAL_MS);
  logger.info("Message status sync worker started");
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop, syncBatch };

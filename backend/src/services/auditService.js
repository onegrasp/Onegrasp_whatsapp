const supabase = require("../config/supabase");
const logger = require("../utils/logger");
const { getContext } = require("../context/requestContext");

/**
 * Append-only record of admin actions: who did what, to what, and when.
 * Writes to audit_logs (see migrations.sql). Never throws and never blocks the
 * action being audited; a failed write is logged instead.
 *
 * `details` must not contain secrets or message text — record which fields
 * changed, ids and counts, not values.
 */
const record = (action, entity, entityId = null, details = {}, context = getContext()) => {
  const { userId, requestId } = context || {};
  const row = {
    action,
    entity,
    entity_id: entityId === null || entityId === undefined ? null : String(entityId),
    new_value: { ...details, requestId: requestId || null },
    performed_by: userId && userId !== "anonymous" ? userId : "anonymous",
  };
  return Promise.resolve()
    .then(() => supabase.from("audit_logs").insert([row]))
    .then((res) => {
      if (res && res.error) logger.warn("Could not write audit entry", { action, entity, error: res.error.message });
    })
    .catch((err) => logger.warn("Could not write audit entry", { action, entity, error: err.message }));
};

module.exports = { record };

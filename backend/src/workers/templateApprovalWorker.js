const templateService = require("../services/templateService");
const supabase = require("../config/supabase");
const logger = require("../utils/logger");

// Meta often emails "template approved" before Twilio reflects it. This checks
// every template still marked pending on a timer, so the app picks up the
// approval without anyone clicking "Check status".
const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

let timer = null;
let firstRun = null;
let running = false;

const tick = async () => {
  if (running || !supabase.isConfigured) return;
  running = true;
  try {
    const { checked, changed } = await templateService.syncAwaitingTemplates();
    changed.forEach((t) => logger.info(`Template "${t.name}" is now ${t.status} (automatic check).`));
    if (checked > 0 && changed.length === 0) logger.debug(`Checked ${checked} template(s) awaiting approval; no change.`);
  } catch (err) {
    logger.warn("Automatic template approval check failed", { error: err.message });
  } finally {
    running = false;
  }
};

const start = () => {
  if (timer) return;
  firstRun = setTimeout(tick, FIRST_RUN_DELAY_MS);
  timer = setInterval(tick, INTERVAL_MS);
  logger.info("Template approval check started (every 10 minutes)");
};

const stop = () => {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  timer = null;
  firstRun = null;
};

module.exports = { start, stop, tick };

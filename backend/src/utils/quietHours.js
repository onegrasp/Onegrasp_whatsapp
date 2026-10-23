// Quiet hours: campaign messages are held back overnight in the recipients'
// timezone, because night-time marketing drives blocks and reports.

const toMinutes = (hhmm) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
};

// Minutes since midnight (and seconds) of `date` in `timeZone`.
const localClock = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { minutes: get("hour") * 60 + get("minute"), seconds: get("second") };
};

/**
 * If `date` falls inside the quiet window, returns the Date when the window
 * ends; otherwise null. Supports windows that cross midnight (21:00-09:00).
 */
const quietHoursEnd = (date, { enabled = true, start, end, timeZone = "Asia/Kolkata" } = {}) => {
  if (!enabled) return null;
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null || startMin === endMin) return null;

  let clock;
  try {
    clock = localClock(date, timeZone);
  } catch (e) {
    return null; // invalid timezone: don't block sending
  }

  const now = clock.minutes;
  const inside = startMin < endMin ? now >= startMin && now < endMin : now >= startMin || now < endMin;
  if (!inside) return null;

  const minutesUntilEnd = (endMin - now + 1440) % 1440;
  return new Date(date.getTime() + minutesUntilEnd * 60000 - clock.seconds * 1000);
};

module.exports = { quietHoursEnd, toMinutes };

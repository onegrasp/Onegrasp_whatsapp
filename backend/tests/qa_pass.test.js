// Regression tests for the QA pass of 2026-10-24: duplicate sends, partial
// campaigns, sessions, logging, auditing, error messages and data paging.
const test = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-qa-pass-tests-0123456789";

const whatsappService = require("../src/services/whatsappService");
const messageRepository = require("../src/repositories/messageRepository");
const contactRepository = require("../src/repositories/contactRepository");
const conversationRepository = require("../src/repositories/conversationRepository");
const jobRepository = require("../src/repositories/jobRepository");
const settingsRepository = require("../src/repositories/settingsRepository");
const campaignWorker = require("../src/workers/campaignWorker");
const queueWorker = require("../src/workers/queueWorker");
const retryWorker = require("../src/workers/retryWorker");
const campaignProgress = require("../src/services/campaignProgress");
const { queueJobsAllOrNothing } = require("../src/controllers/bulkSendController");
const { sendSingle } = require("../src/controllers/sendController");

const withStubs = async (stubs, fn) => {
  const originals = stubs.map(([obj, key]) => [obj, key, obj[key]]);
  stubs.forEach(([obj, key, value]) => {
    obj[key] = value;
  });
  try {
    await fn();
  } finally {
    originals.forEach(([obj, key, value]) => {
      obj[key] = value;
    });
  }
};

// Stands in for any Supabase query chain: every call returns the chain, and
// awaiting it gives an empty result. Keeps tests off the network.
const emptyQuery = () =>
  new Proxy(function () {}, {
    get: (target, prop) => (prop === "then" ? (resolve) => resolve({ data: null, error: null }) : emptyQuery()),
    apply: () => emptyQuery(),
  });
const supabaseClient = require("../src/config/supabase");

const campaignJob = { id: "job-1", campaign_id: "camp-1", phone: "+919876543210", type: "text", message: "Hello {{name}}", params: [], attempts: 0, max_attempts: 3 };
const quietContact = [
  [contactRepository, "findByPhone", async () => ({ name: "Asha", is_active: true })],
  [contactRepository, "isOptedOut", async () => false],
  [whatsappService, "getActiveProvider", async () => "twilio"],
  [conversationRepository, "upsert", async () => ({})],
];

// --- Duplicate sends -------------------------------------------------------

test("a message that was sent is not resent when saving it fails", async () => {
  let sends = 0;
  await withStubs(
    [
      ...quietContact,
      [messageRepository, "hasCampaignMessage", async () => false],
      [whatsappService, "sendTextMessage", async () => { sends++; return { sid: "SM123" }; }],
      [messageRepository, "create", async () => { throw new Error("database down"); }],
    ],
    async () => {
      const result = await campaignWorker.process(campaignJob); // must not throw
      assert.strictEqual(result.messageSid, "SM123");
      assert.strictEqual(sends, 1);
    }
  );
});

test("a campaign never messages the same number twice", async () => {
  let sends = 0;
  await withStubs(
    [
      ...quietContact,
      [messageRepository, "hasCampaignMessage", async () => true],
      [whatsappService, "sendTextMessage", async () => { sends++; return { sid: "SM1" }; }],
    ],
    async () => {
      const result = await campaignWorker.process(campaignJob);
      assert.strictEqual(result.alreadySent, true);
      assert.strictEqual(sends, 0);
    }
  );
});

test("bookkeeping errors after a send don't trigger a retry", async () => {
  let retries = 0;
  await withStubs(
    [
      [campaignWorker, "process", async () => ({ messageSid: "SM1" })],
      [jobRepository, "update", async () => { throw new Error("database down"); }],
      [campaignProgress, "refreshCampaignProgress", async () => { throw new Error("database down"); }],
      [retryWorker, "scheduleRetry", async () => { retries++; return { type: "rescheduled" }; }],
    ],
    async () => {
      const sent = await queueWorker.handleJob({ ...campaignJob, campaign_id: null });
      assert.strictEqual(sent, true);
      assert.strictEqual(retries, 0);
    }
  );
});

test("unknown job types fail instead of being sent or marked done", async () => {
  let failure;
  await withStubs(
    [[retryWorker, "scheduleRetry", async (job, err) => { failure = err; return { type: "permanent_fail" }; }]],
    async () => {
      const sent = await queueWorker.handleJob({ ...campaignJob, campaign_id: null, type: "analytics_update" });
      assert.strictEqual(sent, false);
      assert.strictEqual(failure.category, "invalid_job");
      assert.ok(retryWorker.PERSISTENT_CATEGORIES.has("invalid_job"));
    }
  );
});

// --- Partial campaigns -----------------------------------------------------

test("a campaign that can't be fully queued sends nothing", async () => {
  const calls = [];
  let inserts = 0;
  await withStubs(
    [
      [jobRepository, "insertMany", async (chunk) => {
        inserts++;
        if (inserts === 2) throw new Error("insert failed");
        calls.push(["insert", chunk.length, chunk[0].status]);
      }],
      [jobRepository, "setStatusForCampaign", async (id, from, to) => { calls.push([id, from.join("+"), to]); return 0; }],
    ],
    async () => {
      const jobs = Array.from({ length: 1500 }, (_, i) => ({ phone: `+9198765${String(i).padStart(5, "0")}`, status: "paused" }));
      await assert.rejects(queueJobsAllOrNothing("camp-9", jobs), /insert failed/);
      // The first chunk was saved on hold, never released, then cancelled.
      assert.deepStrictEqual(calls, [["insert", 1000, "paused"], ["camp-9", "paused+pending", "cancelled"]]);
    }
  );
});

test("a fully queued campaign is released in one step", async () => {
  const calls = [];
  await withStubs(
    [
      [jobRepository, "insertMany", async (chunk) => calls.push(["insert", chunk.length])],
      [jobRepository, "setStatusForCampaign", async (id, from, to) => { calls.push([from.join("+"), to]); return 0; }],
    ],
    async () => {
      await queueJobsAllOrNothing("camp-9", Array.from({ length: 1200 }, () => ({ status: "paused" })));
      assert.deepStrictEqual(calls, [["insert", 1000], ["insert", 200], ["paused", "pending"]]);
    }
  );
});

// --- Chats: a sent message is never reported as failed ---------------------

test("a chat message that was sent isn't reported as failed when saving it fails", async () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  await withStubs(
    [
      [supabaseClient, "from", () => emptyQuery()],
      [contactRepository, "findOptOut", async () => null],
      [whatsappService, "sendTextMessage", async () => ({ sid: "SM777" })],
      [messageRepository, "create", async () => { throw new Error("database down"); }],
    ],
    async () => {
      await sendSingle({ body: { phone: "+919876543210", message: "Hi" }, app: { get: () => null } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.message_id, "SM777");
    }
  );
});

test("chat sends reject oversized or malformed input", async () => {
  const send = async (body) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await sendSingle({ body, app: { get: () => null } }, res);
    return res;
  };
  assert.strictEqual((await send({ phone: "+919876543210", message: "x".repeat(5000) })).statusCode, 400);
  assert.strictEqual((await send({ phone: "+919876543210", message: "hi", mediaUrl: "javascript:alert(1)" })).statusCode, 400);
});

// --- Sessions ---------------------------------------------------------------

const sessionService = require("../src/services/sessionService");
const authenticateToken = require("../src/middleware/auth");

const runAuth = async (token) => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  let passed = false;
  await authenticateToken({ path: "/api/v1/contacts", headers: token ? { authorization: `Bearer ${token}` } : {} }, res, () => { passed = true; });
  return { passed, res };
};

test("signing out blocks the token; expired or invalid tokens get 401 (back to sign-in)", async () => {
  let stored = null;
  await withStubs(
    [
      [settingsRepository, "findByKey", async () => (stored ? { key: "revokedSessions", value: stored } : null)],
      [settingsRepository, "upsert", async (key, value) => { stored = value; }],
    ],
    async () => {
      const token = sessionService.issue();
      assert.strictEqual((await runAuth(token)).passed, true);

      assert.strictEqual(await sessionService.revoke(token), true);
      const after = await runAuth(token);
      assert.strictEqual(after.passed, false);
      assert.strictEqual(after.res.statusCode, 401);
      assert.ok(stored.length === 1 && stored[0].jti);

      const garbage = await runAuth("not-a-token");
      assert.strictEqual(garbage.res.statusCode, 401);
      assert.strictEqual(garbage.res.body.error.code, "session_expired");
    }
  );
});

test("readiness and liveness probes are public under /api too", async () => {
  for (const path of ["/api/v1/ready", "/api/ready", "/api/v1/live"]) {
    let passed = false;
    await authenticateToken({ path, headers: {} }, {}, () => { passed = true; });
    assert.strictEqual(passed, true, path);
  }
});

// --- Logs carry no personal data or secrets ---------------------------------

const logger = require("../src/utils/logger");

test("logs mask phone numbers, hide secrets and drop message text", () => {
  const original = console.log;
  console.log = () => {};
  try {
    logger.info("Sending text message to +919876543210", {
      phone: "+919876543210",
      phones: ["+911111111111", "+922222222222"],
      body: "Your OTP is 4821",
      twilioAuthToken: "abc123",
      nested: { apiKey: "k", to: "whatsapp:+14155238886" },
    });
  } finally {
    console.log = original;
  }
  const entry = logger.getHistory().slice(-1)[0];
  const text = JSON.stringify(entry);
  assert.ok(!text.includes("9876543210") && !text.includes("14155238886"), text);
  assert.ok(!text.includes("4821") && !text.includes("abc123"), text);
  assert.match(entry.message, /\+•••3210/);
  assert.strictEqual(entry.phones, "[2 numbers]");
  assert.strictEqual(entry.body, "[16 chars]");
});

// --- Audit trail -------------------------------------------------------------

const { summarizeBody } = require("../src/middleware/auditTrail");

test("audit entries record which fields changed, never the values", () => {
  const summary = summarizeBody({ phones: ["+911", "+912"], message: "Big sale", twilioAuthToken: "secret", status: "opted_out", name: "Asha" });
  assert.deepStrictEqual(summary, { phones: "2 items", message: "(set)", twilioAuthToken: "(set)", status: "opted_out", name: "(set)" });
});

// --- Error messages -------------------------------------------------------------

const errorHandler = require("../src/errors/errorHandler");

const handle = (err) => {
  let sent;
  const res = { status: (code) => ({ json: (body) => { sent = { code, body }; } }) };
  const original = console.error;
  console.error = () => {};
  try {
    errorHandler(err, {}, res, () => {});
  } finally {
    console.error = original;
  }
  return sent;
};

test("unexpected server errors don't reveal internals; Twilio's reasons still show", () => {
  const internal = handle(new TypeError("fetch failed at supabase.co/rest/v1/settings"));
  assert.strictEqual(internal.code, 500);
  assert.match(internal.body.error.message, /^Something went wrong on the server/);
  assert.ok(!internal.body.error.message.includes("supabase"));

  const twilio = handle(Object.assign(new Error("Content name already exists"), { status: 400, code: 54301, moreInfo: "https://www.twilio.com/docs/errors/54301" }));
  assert.strictEqual(twilio.code, 502);
  assert.strictEqual(twilio.body.error.message, "Twilio: Content name already exists");
});

// --- Credentials are encrypted at rest --------------------------------------------

const secretBox = require("../src/utils/secretBox");

test("saved credentials are encrypted and decrypt back; a changed key reads as empty", async () => {
  const sealed = secretBox.encrypt("my-twilio-token");
  assert.ok(secretBox.isEncrypted(sealed) && !sealed.includes("my-twilio-token"));
  assert.strictEqual(secretBox.decrypt(sealed), "my-twilio-token");

  const supabase = require("../src/config/supabase");
  const fakeTable = (row) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) });
  await withStubs([[supabase, "from", () => fakeTable({ key: "twilioAuthToken", value: sealed })]], async () => {
    assert.strictEqual((await settingsRepository.findByKey("twilioAuthToken")).value, "my-twilio-token");
    const originalKey = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = "a-different-key";
    const original = console.error;
    console.error = () => {};
    try {
      assert.strictEqual((await settingsRepository.findByKey("twilioAuthToken")).value, "");
    } finally {
      console.error = original;
      if (originalKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
      else process.env.SETTINGS_ENCRYPTION_KEY = originalKey;
    }
  });
});

// --- Reading past Supabase's 1,000-row page -----------------------------------

const { fetchAllRows } = require("../src/repositories/queryHelpers");

test("large tables are read page by page, not cut at 1,000 rows", async () => {
  const table = Array.from({ length: 2345 }, (_, i) => ({ id: i }));
  const rows = await fetchAllRows(() => ({
    range: async (from, to) => ({ data: table.slice(from, to + 1), error: null }),
  }));
  assert.strictEqual(rows.length, 2345);
});

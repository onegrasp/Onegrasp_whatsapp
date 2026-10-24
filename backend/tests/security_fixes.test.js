const test = require("node:test");
const assert = require("node:assert");

const contactRepository = require("../src/repositories/contactRepository");
const messageRepository = require("../src/repositories/messageRepository");
const whatsappService = require("../src/services/whatsappService");
const sendingPolicy = require("../src/services/sendingPolicy");
const { sendSingle } = require("../src/controllers/sendController");
const { parseContactsFile, MAX_CONTACT_ROWS } = require("../src/utils/csvParser");
const XLSX = require("xlsx");

// Swap methods for one test, then restore them.
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

const OPTED_OUT = { phone: "+919876543210", opted_out_at: "2026-10-20T10:00:00.000Z" };

// H-01: opt-outs apply to single sends, not just campaigns.
test("opted-out numbers never get templates", async () => {
  await withStubs([[contactRepository, "findOptOut", async () => OPTED_OUT]], async () => {
    assert.match(await sendingPolicy.optOutBlockReason("+919876543210", { template: true }), /opted out/);
  });
});

test("free-form replies to an opted-out number need a message from them after the opt-out", async () => {
  let since;
  await withStubs(
    [
      [contactRepository, "findOptOut", async () => OPTED_OUT],
      [messageRepository, "hasIncomingSince", async (phone, s) => { since = s; return false; }],
    ],
    async () => {
      assert.match(await sendingPolicy.optOutBlockReason("+919876543210"), /once they message you again/);
      assert.strictEqual(since, OPTED_OUT.opted_out_at);
    }
  );
  await withStubs(
    [
      [contactRepository, "findOptOut", async () => OPTED_OUT],
      [messageRepository, "hasIncomingSince", async () => true],
    ],
    async () => {
      assert.strictEqual(await sendingPolicy.optOutBlockReason("+919876543210"), null);
    }
  );
});

test("numbers that didn't opt out are not blocked", async () => {
  await withStubs([[contactRepository, "findOptOut", async () => null]], async () => {
    assert.strictEqual(await sendingPolicy.optOutBlockReason("+919876543210", { template: true }), null);
  });
});

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const fakeReq = (body) => ({ body, app: { get: () => null } });

test("sending from Chats to an opted-out number returns 409 and nothing is sent", async () => {
  let providerCalls = 0;
  const send = async () => { providerCalls++; return { sid: "SM1" }; };
  await withStubs(
    [
      [contactRepository, "findOptOut", async () => OPTED_OUT],
      [messageRepository, "hasIncomingSince", async () => false],
      [whatsappService, "sendTextMessage", send],
      [whatsappService, "sendTemplateMessage", send],
      [whatsappService, "sendTemplateWithParams", send],
    ],
    async () => {
      const textRes = fakeRes();
      await sendSingle(fakeReq({ phone: "+919876543210", message: "Big sale today!" }), textRes);
      assert.strictEqual(textRes.statusCode, 409);
      assert.strictEqual(textRes.body.category, "opt_out");

      const tplRes = fakeRes();
      await sendSingle(fakeReq({ phone: "+919876543210", type: "template", templateName: "promo" }), tplRes);
      assert.strictEqual(tplRes.statusCode, 409);

      assert.strictEqual(providerCalls, 0);
    }
  );
});

test("if the opt-out list can't be read, the message is not sent", async () => {
  let providerCalls = 0;
  await withStubs(
    [
      [contactRepository, "findOptOut", async () => { throw new Error("db down"); }],
      [whatsappService, "sendTextMessage", async () => { providerCalls++; return { sid: "SM1" }; }],
    ],
    async () => {
      const res = fakeRes();
      await sendSingle(fakeReq({ phone: "+919876543210", message: "Hi" }), res);
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(providerCalls, 0);
    }
  );
});

// H-02: contact files over the row limit are refused with a clear error.
test("contact files with too many rows are rejected", async () => {
  const rows = ["Name,Phone"];
  for (let i = 0; i < MAX_CONTACT_ROWS + 5; i++) rows.push(`P${i},+9198${String(i).padStart(8, "0")}`);
  await assert.rejects(parseContactsFile(Buffer.from(rows.join("\n"))), (err) => err.statusCode === 422 && /more than 50,000 rows/.test(err.message));
});

// H-04: in production, webhook signatures are always checked.
const env = require("../src/config/env");
const settingsRepository = require("../src/repositories/settingsRepository");
const settingsService = require("../src/services/settingsService");
const { verifySignature } = require("../src/integrations/twilio/webhook.service");

const unsignedWebhook = { headers: {}, body: { MessageSid: "SM1", MessageStatus: "delivered" }, originalUrl: "/api/v1/webhook/twilio/status" };
const verificationOff = async (key) => (key === "validateWebhookSignature" ? { key, value: false } : null);

test("production rejects unsigned webhooks even if verification was switched off", async () => {
  await withStubs([[env, "IS_PRODUCTION", true], [settingsRepository, "findByKey", verificationOff]], async () => {
    assert.strictEqual(await verifySignature(unsignedWebhook), false);
  });
  // Outside production the switch still works, for local testing.
  await withStubs([[env, "IS_PRODUCTION", false], [settingsRepository, "findByKey", verificationOff]], async () => {
    assert.strictEqual(await verifySignature(unsignedWebhook), true);
  });
});

test("production settings report verification as on and locked, and ignore attempts to turn it off", async () => {
  const written = [];
  await withStubs(
    [
      [env, "IS_PRODUCTION", true],
      [settingsRepository, "findAll", async () => [{ key: "validateWebhookSignature", value: false }]],
      [settingsRepository, "upsert", async (key, value) => written.push([key, value])],
    ],
    async () => {
      const settings = await settingsService.getSettings();
      assert.strictEqual(settings.validateWebhookSignature, true);
      assert.strictEqual(settings.webhookSignatureLocked, true);
      await settingsService.updateSettings({ validateWebhookSignature: false, sendingRate: 2 });
      assert.deepStrictEqual(written.map(([key]) => key), ["sendingRate"]);
    }
  );
});

// H-03: the patched SheetJS build is installed.
test("xlsx is the patched SheetJS release", () => {
  const [major, minor, patch] = XLSX.version.split(".").map(Number);
  assert.ok(major > 0 || minor > 20 || (minor === 20 && patch >= 2), `xlsx ${XLSX.version} is vulnerable; need >= 0.20.2`);
});

const test = require("node:test");
const assert = require("node:assert");

const templateRepository = require("../src/repositories/templateRepository");
const templateService = require("../src/services/templateService");

// Swap repository/service methods for one test, then restore them.
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

const byName = (tpl) => [
  [templateRepository, "findByName", async (name) => (tpl && tpl.name === name ? tpl : null)],
  [templateRepository, "findByContentSid", async () => null],
  [templateRepository, "findById", async () => null],
];

test("approved templates can be sent", async () => {
  await withStubs(byName({ id: "t1", name: "promo", status: "approved", content_sid: "HX1" }), async () => {
    assert.strictEqual((await templateService.checkSendable("promo")).ok, true);
  });
});

test("a template approved by Meta but still 'pending' here is re-checked live and allowed", async () => {
  await withStubs(
    [
      ...byName({ id: "t2", name: "invite", status: "pending", content_sid: "HX2" }),
      [templateService, "syncTemplateStatus", async () => ({ status: "approved", changed: true })],
    ],
    async () => {
      assert.strictEqual((await templateService.checkSendable("invite")).ok, true);
    }
  );
});

test("a template still waiting for approval is blocked with an explanation", async () => {
  await withStubs(
    [
      ...byName({ id: "t3", name: "invite", status: "pending", content_sid: "HX3" }),
      [templateService, "syncTemplateStatus", async () => ({ status: "pending", changed: false })],
    ],
    async () => {
      const result = await templateService.checkSendable("invite");
      assert.strictEqual(result.ok, false);
      assert.match(result.message, /waiting for WhatsApp approval/);
    }
  );
});

test("drafts and rejected templates are blocked; unknown names are left to Twilio", async () => {
  await withStubs(byName({ id: "t4", name: "draft_one", status: "draft", content_sid: "" }), async () => {
    assert.match((await templateService.checkSendable("draft_one")).message, /hasn't been submitted/);
    assert.strictEqual((await templateService.checkSendable("not_in_app")).ok, true);
  });
  await withStubs(byName({ id: "t5", name: "bad", status: "rejected", content_sid: "HX5", rejection_reason: "Variables at start" }), async () => {
    assert.match((await templateService.checkSendable("bad")).message, /rejected by WhatsApp: Variables at start/);
  });
});

test("an image can't be sent with a template that has no image header (Twilio 63021)", async () => {
  const textWithButtons = { id: "t7", name: "mahendra_test_name_", type: "interactive", status: "approved", content_sid: "HX7" };
  await withStubs(byName(textWithButtons), async () => {
    const withImage = await templateService.checkSendable("mahendra_test_name_", { mediaUrl: "https://x/magazine.png" });
    assert.strictEqual(withImage.ok, false);
    assert.match(withImage.message, /has no image/);
    assert.strictEqual((await templateService.checkSendable("mahendra_test_name_")).ok, true);
  });
  const mediaTemplate = { id: "t8", name: "magazine", type: "media", header_image_url: "https://x/m.png", status: "approved", content_sid: "HX8" };
  await withStubs(byName(mediaTemplate), async () => {
    assert.strictEqual((await templateService.checkSendable("magazine", { mediaUrl: "https://x/m.png" })).ok, true);
  });
});

test("templates can't mix quick replies with link/call buttons", () => {
  const { validateButtons } = templateService;
  assert.throws(() => validateButtons([{ type: "URL" }, { type: "phone" }, { type: "reply" }]), /not both/);
  assert.throws(() => validateButtons([{ type: "URL" }, { type: "URL" }, { type: "URL" }]), /at most 2 link/);
  assert.throws(() => validateButtons([{ type: "phone" }, { type: "phone" }]), /only 1 call/);
  assert.doesNotThrow(() => validateButtons([{ type: "URL" }, { type: "phone" }]));
  assert.doesNotThrow(() => validateButtons([{ type: "reply" }, { type: "reply" }, { type: "reply" }]));
  assert.doesNotThrow(() => validateButtons([]));
});

test("if Twilio can't be reached, the stored status is kept (never downgraded)", async () => {
  await withStubs(
    [
      ...byName({ id: "t6", name: "invite", status: "pending", content_sid: "HX6" }),
      [templateService, "syncTemplateStatus", async () => { throw new Error("network down"); }],
    ],
    async () => {
      const result = await templateService.checkSendable("invite");
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, "pending");
    }
  );
});

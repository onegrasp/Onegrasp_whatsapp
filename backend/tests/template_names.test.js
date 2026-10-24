const test = require("node:test");
const assert = require("node:assert");

// templateService grabs getTwilioClient when it loads, so swap it first.
const twilioClient = require("../src/integrations/twilio/client");
let twilioTemplates = [];
twilioClient.getTwilioClient = async () => ({
  content: { v1: { contentAndApprovals: { list: async () => twilioTemplates } } },
});

const templateRepository = require("../src/repositories/templateRepository");
const templateService = require("../src/services/templateService");
const errorHandler = require("../src/errors/errorHandler");

// Fake templates table with the same unique-name rule as Postgres.
const fakeTable = (rows) => {
  const duplicate = (name, id) => rows.some((r) => r.name === name && r.id !== id);
  const conflict = (name) => Object.assign(new Error('duplicate key value violates unique constraint "templates_name_key"'), {
    code: "23505",
    details: `Key (name)=(${name}) already exists.`,
  });
  return {
    rows,
    findByContentSid: async (sid) => rows.find((r) => r.content_sid === sid && !r.deleted_at) || null,
    findByName: async (name) => rows.find((r) => r.name === name && !r.deleted_at) || null,
    findById: async (id) => rows.find((r) => r.id === id && !r.deleted_at) || null,
    nameTakenByOther: async (name, id) => rows.some((r) => r.name === name && !r.deleted_at && r.id !== id),
    releaseDeletedName: async (name) => {
      rows.filter((r) => r.name === name && r.deleted_at).forEach((r) => {
        r.name = `${r.name}__deleted_${r.id.slice(0, 8)}`;
      });
    },
    create: async (data) => {
      if (duplicate(data.name)) throw conflict(data.name);
      const row = { id: `id-${rows.length + 1}-xxxxxxxx`, ...data };
      rows.push(row);
      return row;
    },
    update: async (id, data) => {
      if (data.name && duplicate(data.name, id)) throw conflict(data.name);
      const row = rows.find((r) => r.id === id);
      Object.assign(row, data);
      return row;
    },
  };
};

const withTable = async (rows, fn) => {
  const table = fakeTable(rows);
  const keys = ["findByContentSid", "findByName", "findById", "nameTakenByOther", "releaseDeletedName", "create", "update"];
  const originals = keys.map((k) => templateRepository[k]);
  keys.forEach((k) => {
    templateRepository[k] = table[k];
  });
  try {
    await fn(table);
  } finally {
    keys.forEach((k, i) => {
      templateRepository[k] = originals[i];
    });
  }
};

const twilioTemplate = (sid, friendlyName) => ({
  sid,
  friendlyName,
  language: "en",
  types: { "twilio/text": { body: "Hello {{1}}" } },
  approvalRequests: { status: "approved" },
});

test("sync re-imports a template whose name is held by a deleted one", async () => {
  twilioTemplates = [twilioTemplate("HXnew000001", "offer")];
  await withTable([{ id: "old-row-1", name: "offer", content_sid: "HXold", deleted_at: "2026-10-01" }], async (table) => {
    const result = await templateService.syncAllTemplates();
    assert.strictEqual(result.created, 1);
    assert.deepStrictEqual(result.skipped, []);
    const active = table.rows.filter((r) => !r.deleted_at);
    assert.strictEqual(active[0].name, "offer");
  });
});

test("sync keeps two Twilio templates with the same name instead of failing", async () => {
  twilioTemplates = [twilioTemplate("HXaaaa111111", "invite"), twilioTemplate("HXbbbb222222", "invite")];
  await withTable([], async (table) => {
    const result = await templateService.syncAllTemplates();
    assert.deepStrictEqual(result.skipped, []);
    assert.deepStrictEqual(table.rows.map((r) => r.name).sort(), ["invite", "invite_222222"]);
  });
});

test("sync doesn't rename a template onto a name another template uses", async () => {
  twilioTemplates = [twilioTemplate("HX1", "promo")];
  await withTable(
    [
      { id: "a", name: "promo_old", content_sid: "HX1" },
      { id: "b", name: "promo", content_sid: "" },
    ],
    async (table) => {
      const result = await templateService.syncAllTemplates();
      assert.deepStrictEqual(result.skipped, []);
      assert.strictEqual(table.rows.find((r) => r.id === "a").name, "promo_old");
      assert.strictEqual(table.rows.find((r) => r.id === "a").status, "approved");
    }
  );
});

test("one failing template doesn't stop the sync", async () => {
  twilioTemplates = [twilioTemplate("HXbad", "broken"), twilioTemplate("HXok", "fine")];
  await withTable([], async (table) => {
    const create = templateRepository.create;
    templateRepository.create = async (data) => {
      if (data.name === "broken") throw new Error("boom");
      return create(data);
    };
    const result = await templateService.syncAllTemplates();
    assert.deepStrictEqual(result.skipped, ["broken"]);
    assert.strictEqual(result.created, 1);
    assert.match(result.message, /Couldn't sync: broken/);
    assert.ok(table.rows.some((r) => r.name === "fine"));
  });
});

test("creating or renaming to a deleted template's name works; an active name is refused", async () => {
  await withTable([{ id: "gone-123456789", name: "welcome", deleted_at: "2026-10-01" }, { id: "live", name: "promo" }], async (table) => {
    const created = await templateService.createTemplate({ name: "welcome", body: "Hi" });
    assert.strictEqual(created.name, "welcome");
    await assert.rejects(templateService.createTemplate({ name: "promo", body: "Hi" }), /already exists/);
    await assert.rejects(templateService.updateTemplate(created.id, { name: "promo" }), /already exists/);
    assert.strictEqual(table.rows.find((r) => r.id === "gone-123456789").name, "welcome__deleted_gone-123");
  });
});

test("a media template without an image can't be submitted (no stand-in picture is sent)", async () => {
  await withTable([{ id: "m1", name: "promo_img", type: "media", body: "Hi", buttons: [], header_image_url: "" }], async () => {
    await assert.rejects(templateService.submitTemplate("m1"), /Add an image/);
  });
});

test("database duplicate errors become a readable 409", () => {
  let sent;
  const res = { status: (code) => ({ json: (body) => { sent = { code, body }; } }) };
  const err = Object.assign(new Error('duplicate key value violates unique constraint "templates_name_key"'), {
    code: "23505",
    details: "Key (name)=(offer) already exists.",
  });
  errorHandler(err, {}, res, () => {});
  assert.strictEqual(sent.code, 409);
  assert.strictEqual(sent.body.error.message, 'The name "offer" is already in use. Choose a different name.');
});

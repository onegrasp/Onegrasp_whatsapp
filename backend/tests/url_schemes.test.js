const test = require("node:test");
const assert = require("node:assert");

const { isHttpUrl } = require("../src/utils/url");
const { validateTemplate } = require("../src/validators/template.validator");
const { validateSendMessage } = require("../src/validators/message.validator");
const { sendBulk, campaignPreflight } = require("../src/controllers/bulkSendController");

const REJECTED = ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://x", "file:///etc/passwd", "http://", "not a url"];
const ACCEPTED = ["https://example.com/i.png", "http://example.com/register?ref=wa", "HTTPS://Example.com/Path"];

const template = (extra) => ({ name: "promo", body: "Hello", ...extra });
const button = (url) => ({ type: "URL", text: "Open", url });

test("only http and https links are accepted", () => {
  for (const url of REJECTED) assert.strictEqual(isHttpUrl(url), false, url);
  for (const url of ACCEPTED) assert.strictEqual(isHttpUrl(url), true, url);
});

test("template button links reject dangerous schemes with a clear message", () => {
  for (const url of REJECTED) {
    assert.throws(() => validateTemplate(template({ buttons: [button(url)] })), /URL must start with http:\/\/ or https:\/\//, url);
  }
  for (const url of ACCEPTED) {
    assert.strictEqual(validateTemplate(template({ buttons: [button(url)] })).buttons[0].url, url);
  }
});

test("template header images reject dangerous schemes with a clear message", () => {
  for (const url of REJECTED) {
    assert.throws(() => validateTemplate(template({ headerImageUrl: url })), /URL must start with http:\/\/ or https:\/\//, url);
  }
  assert.strictEqual(validateTemplate(template({ headerImageUrl: "https://example.com/i.png" })).headerImageUrl, "https://example.com/i.png");
});

test("empty or missing links stay allowed where the field is optional", () => {
  assert.doesNotThrow(() => validateTemplate(template({})));
  assert.doesNotThrow(() => validateTemplate(template({ headerImageUrl: "" })));
  assert.doesNotThrow(() => validateTemplate(template({ headerImageUrl: null })));
  assert.doesNotThrow(() => validateTemplate(template({ buttons: [{ type: "reply", text: "Yes" }] })));
  assert.doesNotThrow(() => validateTemplate(template({ buttons: [{ type: "phone", text: "Call", url: "", phone: "+919876543210" }] })));
});

test("chat attachments use the same rule", () => {
  assert.throws(() => validateSendMessage({ phone: "+919876543210", mediaUrl: "javascript:alert(1)" }), /URL must start with/);
  assert.doesNotThrow(() => validateSendMessage({ phone: "+919876543210", mediaUrl: "https://example.com/i.png" }));
});

test("campaign images use the same rule (send and preflight)", async () => {
  const call = async (handler, body) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await handler({ body, app: { get: () => null } }, res, (err) => { throw err; });
    return res;
  };
  const body = { phones: ["+919876543210"], type: "text", message: "Hi", mediaUrl: "data:text/html,<b>x</b>" };
  for (const handler of [sendBulk, campaignPreflight]) {
    const res = await call(handler, body);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /URL must start with http:\/\/ or https:\/\//);
  }
});

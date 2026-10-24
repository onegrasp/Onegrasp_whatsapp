// A stand-in for the backend during browser tests. It answers the app's API
// calls from in-memory data with the same response shapes as the real server,
// and records every request so tests can check what the app sent.

export const API = "http://api.test";
export const PASSWORD = "correct-password";

// `time` fixes every timestamp (for screenshot comparisons); default is now.
const seed = (time) => {
  const now = () => time || new Date().toISOString();
  return {
  contacts: [
    { _id: "c1", name: "Asha Rao", phone: "+919876543210", label: "none", tags: [], isActive: true, consentStatus: "opted_in", invalidReason: "", createdAt: now() },
    { _id: "c2", name: "Ravi Kumar", phone: "+919812345678", label: "none", tags: [], isActive: false, consentStatus: "opted_out", invalidReason: "", createdAt: now() },
    { _id: "c3", name: "Meena Iyer", phone: "+919900112233", label: "new_contacts", tags: ["new_contacts"], isActive: true, consentStatus: "unknown", invalidReason: "", createdAt: now() },
  ],
  conversations: [
    { phone: "+919876543210", name: "Asha Rao", label: "none", isImportant: false, isOptedOut: false, lastMessage: "Is the event on Friday?", lastDirection: "incoming", lastStatus: "delivered", lastTimestamp: now(), unreadCount: 1 },
    { phone: "+919812345678", name: "Ravi Kumar", label: "none", isImportant: false, isOptedOut: true, lastMessage: "STOP", lastDirection: "incoming", lastStatus: "delivered", lastTimestamp: now(), unreadCount: 0 },
  ],
  messages: {
    "+919876543210": [
      { _id: "m1", phone: "+919876543210", text: "Is the event on Friday?", type: "text", direction: "incoming", status: "delivered", messageId: "SMin1", timestamp: now() },
    ],
    "+919812345678": [{ _id: "m2", phone: "+919812345678", text: "STOP", type: "text", direction: "incoming", status: "delivered", messageId: "SMin2", timestamp: now() }],
  },
  templates: [
    { id: "t1", _id: "t1", name: "event_reminder", body: "Hi there, see you at the event!", type: "text", status: "approved", content_sid: "HX111", variables: [], buttons: [], header_image_url: "", category: "UTILITY", language: "en", created_at: now() },
    { id: "t2", _id: "t2", name: "spring_offer", body: "Our spring offer is live.", type: "text", status: "pending", content_sid: "HX222", variables: [], buttons: [], header_image_url: "", category: "MARKETING", language: "en", created_at: now() },
  ],
  campaigns: [
    { _id: "k1", name: "October newsletter", templateName: "event_reminder", type: "template", totalContacts: 120, sentCount: 118, deliveredCount: 110, readCount: 80, failedCount: 2, status: "completed", statusReason: "", createdAt: now() },
  ],
  settings: {
    autoReplyEnabled: false, autoReplyMessage: "Thanks!", twilioMode: "production", twilioAccountSid: "AC123", twilioAuthToken: "••••••••",
    twilioWhatsappNumber: "+919999999999", twilioMessagingServiceSid: "", validateWebhookSignature: true, webhookSignatureLocked: true, sendingRate: 2,
    dailyConversationLimit: 1000, campaignCooldownDays: 3, quietHoursEnabled: false, quietHoursStart: "21:00", quietHoursEnd: "09:00",
    quietHoursTimezone: "Asia/Kolkata", autoReplyCooldownHours: 12, messageRetentionDays: 60,
  },
  stats: { totalContacts: 3, totalMessages: 240, sentMessages: 10, deliveredMessages: 150, readMessages: 70, failedMessages: 6, incomingMessages: 4, deliveryRate: 93 },
  logs: [{ timestamp: now(), level: "INFO", message: "[HTTP POST] /api/v1/send-message -> 200", requestId: "r1" }],
  };
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, cache-control, pragma",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export async function installFakeApi(page, { failures = {}, time = null } = {}) {
  const state = { ...seed(time), requests: [], failures: { ...failures } };
  const now = () => time || new Date().toISOString();

  const reply = (route, status, body) =>
    route.fulfill({ status, headers: { ...corsHeaders, "content-type": "application/json" }, body: JSON.stringify(body) });

  // Live updates (Socket.io) aren't simulated: refuse them quickly.
  await page.route(`${API}/socket.io/**`, (route) => route.abort());

  await page.route(`${API}/api/v1/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders });

    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/api\/v1/, ""));
    const query = Object.fromEntries(url.searchParams);
    let body = null;
    try {
      body = request.postDataJSON();
    } catch (e) {
      body = null; // multipart upload or empty body
    }
    state.requests.push({ method, path, query, body });

    const failure = state.failures[`${method} ${path}`];
    if (failure) return reply(route, failure.status, failure.body);

    const authed = Boolean(request.headers()["authorization"]);
    if (!authed && !path.startsWith("/auth") && path !== "/health") {
      return reply(route, 401, { success: false, error: { code: "unauthorized", message: "Access denied." } });
    }

    if (path === "/health") return reply(route, 200, { status: "healthy" });
    if (path === "/auth/login") {
      return body?.password === PASSWORD
        ? reply(route, 200, { success: true, token: "e2e-session-token" })
        : reply(route, 401, { success: false, error: { code: "unauthorized", message: "Invalid admin password" } });
    }
    if (path === "/auth/logout") return reply(route, 200, { success: true });

    if (path === "/settings") return method === "GET" ? reply(route, 200, state.settings) : reply(route, 200, { message: "Settings updated successfully" });
    if (path === "/stats") return reply(route, 200, state.stats);
    if (path === "/logs") return reply(route, 200, { success: true, count: state.logs.length, data: state.logs });

    if (path === "/contacts/sets") return reply(route, 200, { success: true, sets: { all: state.contacts.length, test_contacts: 0, new_contacts: 1 } });
    if (path === "/contacts" && method === "GET") {
      const s = (query.search || "").toLowerCase();
      const list = state.contacts.filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone.includes(s));
      return reply(route, 200, { contacts: list, total: list.length, page: Number(query.page || 1), limit: Number(query.limit || 50) });
    }
    if (path === "/contacts" && method === "POST") {
      const contact = { _id: `c${state.contacts.length + 1}`, name: body.name, phone: `+${body.countryCode || "91"}${String(body.phone).replace(/\D/g, "")}`, label: "none", tags: [], isActive: true, consentStatus: body.consent ? "opted_in" : "unknown", invalidReason: "", createdAt: now() };
      state.contacts.unshift(contact);
      return reply(route, 201, contact);
    }

    if (path === "/conversations") {
      const s = (query.search || "").toLowerCase();
      return reply(route, 200, state.conversations.filter((c) => !s || c.name.toLowerCase().includes(s) || c.phone.includes(s)));
    }
    if (path.startsWith("/messages/")) {
      const phone = path.slice("/messages/".length);
      return reply(route, 200, { messages: state.messages[phone] || [], total: (state.messages[phone] || []).length });
    }
    if (path === "/send-message") {
      const convo = state.conversations.find((c) => c.phone === body.phone);
      if (convo?.isOptedOut) {
        return reply(route, 409, { error: "This contact opted out. You can reply once they message you again, or they can opt back in by replying START.", category: "opt_out" });
      }
      const saved = { id: `out${state.requests.length}`, phone: body.phone, text: body.message, direction: "outgoing", status: "sent", message_id: `SM${state.requests.length}`, timestamp: now() };
      (state.messages[body.phone] ||= []).push({ _id: saved.id, ...saved, messageId: saved.message_id });
      return reply(route, 200, { message: "Message sent", data: saved });
    }

    if (path === "/templates" && method === "GET") return reply(route, 200, { success: true, data: state.templates });

    if (path === "/campaigns" && method === "GET") return reply(route, 200, state.campaigns);
    if (/^\/campaigns\/[^/]+\/messages$/.test(path)) return reply(route, 200, []);
    if (path === "/campaigns/preflight") {
      const phones = body.phones || [];
      const optedOut = phones.filter((p) => state.contacts.find((c) => c.phone === p && c.isActive === false)).length;
      return reply(route, 200, {
        templateBlocked: null, templateStatus: "approved", selected: phones.length, willSend: phones.length - optedOut,
        invalidFormat: 0, optedOut, recentlyContacted: 0, noConsent: 0, withoutConsent: 0, notOnWhatsApp: 0, cooldownDays: 3,
        dailyLimit: { limit: 1000, used: 12, remaining: 988 }, startsAt: now(), delayedByQuietHours: false,
        quietHours: { enabled: false, start: "21:00", end: "09:00", timeZone: "Asia/Kolkata" },
      });
    }
    if (path === "/send-bulk") {
      const queued = (body.phones || []).length;
      state.campaigns.unshift({ _id: "k-new", name: body.campaignName, templateName: body.templateName, type: body.type, totalContacts: queued, sentCount: 0, deliveredCount: 0, readCount: 0, failedCount: 0, status: "running", statusReason: "", createdAt: now() });
      return reply(route, 200, { message: "Campaign queued successfully", campaignId: "k-new", total: queued, queued, failed: 0, skippedRecent: 0, skippedNoConsent: 0, startsAt: now(), delayedByQuietHours: false, batches: 1 });
    }

    return reply(route, 404, { success: false, error: { code: "not_found", message: `Fake API has no route for ${method} ${path}` } });
  });

  return state;
}

// Starts the app already signed in (with the token the fake API accepts).
// Only once per tab, so signing out or an expired session really signs out.
export async function signIn(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("e2e-signed-in")) return;
    sessionStorage.setItem("e2e-signed-in", "1");
    sessionStorage.setItem("token", "e2e-session-token");
  });
}

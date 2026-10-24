# OneGrasp WhatsApp — Developer Guide

> **Written for:** a developer new to this codebase who is taking it over with no prior context.
> This document explains what the app does, how it's built, how it's deployed, and the
> non-obvious things you need to know to work on it safely.

---

## Table of contents
1. [What this application is](#1-what-this-application-is)
2. [Technology stack](#2-technology-stack)
3. [High-level architecture](#3-high-level-architecture)
4. [Where everything is deployed](#4-where-everything-is-deployed)
5. [Repository layout](#5-repository-layout)
6. [How the backend is structured](#6-how-the-backend-is-structured)
7. [Core features & how they work end-to-end](#7-core-features--how-they-work-end-to-end)
8. [Database schema](#8-database-schema)
9. [WhatsApp providers (Twilio & Meta)](#9-whatsapp-providers-twilio--meta)
10. [Environment variables](#10-environment-variables)
11. [Running it locally](#11-running-it-locally)
12. [Deployment & how to ship changes](#12-deployment--how-to-ship-changes)
13. [Important gotchas (read this!)](#13-important-gotchas-read-this)
14. [Troubleshooting](#14-troubleshooting)
15. [Tests](#15-tests)

---

## 1. What this application is

It's a **WhatsApp bulk-messaging and chat tool** for one business (OneGrasp). An admin logs in
with a single password and can:

- **Upload contacts** from CSV/Excel and organize them into "sets" and labels.
- **Create message templates** (text or image + text + buttons) and submit them for WhatsApp approval.
- **Send bulk campaigns** (template or free text) to selected contacts.
- **Chat two-way** with customers in real time (incoming replies show up live).
- **Track delivery** per message (sent → delivered → read → failed) and per campaign.
- **View system logs** and dashboard stats.

Messages are sent through **Twilio** (and the code also supports Meta's WhatsApp Cloud API).
It is a **single-tenant, single-admin** app — there are no user accounts, just one shared admin password.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS, React Router, axios, socket.io-client |
| Backend | Node.js + Express |
| Database | Supabase (hosted PostgreSQL) |
| Real-time | Socket.io |
| Messaging | Twilio WhatsApp API (primary) and/or Meta WhatsApp Cloud API |
| Auth | Single admin password → JWT (JSON Web Token) |
| File parsing | `xlsx` + `csv-parse` for contact uploads |
| Validation | `zod` |
| Security | `helmet`, `express-rate-limit` |

---

## 3. High-level architecture

```
                 ┌──────────────────────────┐
  Browser  ────► │  Frontend (React SPA)    │   hosted on Vercel
                 │  onegraspconnect.vercel.app
                 └───────────┬──────────────┘
                             │  HTTPS (axios)  +  WebSocket (socket.io)
                             ▼
                 ┌──────────────────────────┐
                 │  Backend (Express API)   │   hosted on Render
                 │  onegrasp-backend.onrender.com
                 └───┬───────────┬──────────┘
                     │           │
         ┌───────────▼──┐   ┌────▼───────────────┐
         │  Supabase    │   │  Twilio / Meta     │
         │  (Postgres)  │   │  (WhatsApp sending)│
         └──────────────┘   └────────────────────┘
                     ▲
                     │  Webhooks (incoming msgs, delivery status)
         Twilio/Meta ┘  →  POST to backend /api/webhook/...
```

**Flow in words:**
1. The **frontend** (a static React app on Vercel) talks to the **backend API** over HTTPS and keeps a live **WebSocket** for real-time updates.
2. The **backend** stores everything in **Supabase (Postgres)** and sends WhatsApp messages via **Twilio** (or Meta).
3. When a customer replies or a message's status changes, Twilio/Meta call the backend's **webhook** endpoints, which update the DB and push live events to the frontend over the socket.
4. Bulk sends are **queued** in a `jobs` table and processed by a **background worker** at a controlled rate.

---

## 4. Where everything is deployed

| Piece | Host | URL / identifier |
|---|---|---|
| Frontend | **Vercel** | `https://onegraspconnect.vercel.app` |
| Backend API | **Render** | `https://onegrasp-backend.onrender.com` |
| Database | **Supabase** | your Supabase project URL |
| WhatsApp sending | **Twilio** | see the Twilio Console (account and number are not recorded here) |

> The frontend knows the backend URL from the `VITE_API_URL` build-time env var. If that isn't
> set, production builds use `https://onegrasp-backend.onrender.com` and local development
> (`npm run dev`) uses `http://localhost:5000`, so a laptop never touches production data by
> accident (see [`frontend/src/lib/config.js`](frontend/src/lib/config.js)). If the production
> API address changes, also update `connect-src` in `frontend/vercel.json`: the browser is only
> allowed to talk to that address.

---

## 5. Repository layout

```
Onegrasp_whatsapp/
├── api/index.js              # Vercel serverless entry (wraps backend app) — only used if backend runs on Vercel
├── vercel.json               # Vercel config (root) — rewrites + cron
├── package.json              # root build scripts
│
├── frontend/                 # React + Vite single-page app
│   ├── src/
│   │   ├── main.jsx          # app bootstrap + error boundary
│   │   ├── App.jsx           # routing + the Login screen
│   │   ├── services/api.js   # axios client — ALL backend calls live here
│   │   ├── context/SocketContext.jsx   # socket.io connection
│   │   ├── components/       # Sidebar, MessageBubble
│   │   └── pages/            # Dashboard, Templates, BulkSender, Chats, Contacts, Campaigns, Logs
│   ├── vite.config.js
│   └── vercel.json
│
└── backend/                  # Node + Express API
    ├── server.js             # entry point (npm start → node server.js)
    ├── supabase_schema.sql   # base DB schema
    ├── migrations.sql        # follow-up DB changes (indexes, triggers, opt_outs, etc.)
    ├── migrations/           # additional SQL migrations (e.g. 003_enable_rls.sql)
    ├── tests/                # node:test unit tests
    └── src/
        ├── server.js         # Express app setup (middleware, CORS, routes, socket, worker)
        ├── config/           # env.js, supabase.js, twilio.js
        ├── middleware/       # auth (JWT), security (helmet + rate limit), requestLogger
        ├── routes/v1/        # API route definitions (contacts, templates, messages, webhooks, …)
        ├── controllers/      # HTTP handlers — parse request, call a service, return response
        ├── services/         # business logic (campaignService, messageService, templateService, …)
        ├── repositories/     # database access (one file per table)
        ├── integrations/
        │   ├── twilio/       # Twilio client + messaging + content (templates) + webhooks
        │   └── meta/         # Meta Cloud API client + messaging + webhooks
        ├── workers/          # background queue worker + per-job-type processors
        ├── events/           # in-process event bus + handlers (incoming msg, status update)
        ├── utils/            # phone formatting, CSV parser, logger, template helpers, metrics
        └── validators/       # zod schemas
```

---

## 6. How the backend is structured

The backend follows a **layered** pattern. A request flows top-to-bottom:

```
HTTP request
   │
   ▼
routes/v1/*.js        → defines the URL + which controller handles it
   │
   ▼
controllers/*.js      → reads req, calls a service, sends the response
   │
   ▼
services/*.js         → the actual business logic
   │
   ▼
repositories/*.js     → talks to Supabase (the database)
   │
   ▼
Supabase (Postgres)
```

Supporting pieces:
- **`integrations/twilio` and `integrations/meta`** — everything that talks to the WhatsApp providers.
- **`workers/`** — the background queue that actually sends bulk messages (see below).
- **`events/`** — a lightweight in-process event bus. Webhooks publish events (e.g. `IncomingMessageEvent`) and handlers in `events/handlers/index.js` react to them (save the message, push to the socket, maybe auto-reply).

> ⚠️ **Two send paths exist.** Most of the app uses the clean `routes → controllers → services`
> layering, but the `/send-bulk` and `/send-message` endpoints the UI actually calls go through
> [`controllers/sendController.js`](backend/src/controllers/sendController.js), which talks to
> Supabase directly (a legacy path). Keep that in mind when changing send behavior — you may need
> to update both `sendController.js` and `services/campaignService.js`.

### How bulk sending actually works (the queue)

1. UI calls `POST /api/v1/send-bulk` with the list of phone numbers.
2. The backend creates a **campaign** row and inserts one **job** row per recipient into the `jobs` table (status `pending`).
3. A **background worker** (`workers/queueWorker.js`) continuously pulls one pending job at a time using a Postgres function `pull_pending_job()` (which uses `FOR UPDATE SKIP LOCKED` so multiple workers don't grab the same job).
4. For each job, `workers/campaignWorker.js` sends the message via Twilio/Meta, records the result in `messages`, and emits a live progress event over the socket.
5. Failures are retried with backoff by `workers/retryWorker.js` (permanent failures like invalid number / opt-out are not retried).
6. The sending **rate** (messages/second) is configurable in the app Settings.

---

## 7. Core features & how they work end-to-end

### Authentication
- One shared **admin password** (`ADMIN_PASSWORD` env var). There are no user accounts.
- `POST /api/v1/auth/login` checks the password and returns a **JWT** signed with `JWT_SECRET`.
- The frontend stores the token in `sessionStorage` and sends it as `Authorization: Bearer <token>` on every request.
- The JWT middleware ([`middleware/auth.js`](backend/src/middleware/auth.js)) protects all routes except public ones (login, webhooks, health).

### Contacts
- Upload CSV/Excel → [`utils/csvParser.js`](backend/src/utils/csvParser.js) auto-detects the phone & name columns, normalizes numbers to E.164 (`+<countrycode><number>`), de-duplicates, and upserts into `contacts`.
- Contacts can be tagged into **sets/labels** (e.g. `interested`, `follow_up`, custom sets) for targeting campaigns.
- Soft-delete is used (`deleted_at` column) — rows aren't physically removed.

### Templates
- Create a template (name, body, category, language, optional image header, optional buttons) in the **Templates** page.
- Stored in the `templates` table as a **draft**.
- "Submit Meta" sends it to **Twilio's Content API**, which registers it with WhatsApp for approval. Twilio returns a **Content SID** (`HX...`). Status becomes `pending` → `approved`/`rejected`.
- "Sync" pulls the latest approved templates/statuses back from Twilio.

### Sending
- **Template message** — required for contacting people who haven't messaged you recently (cold outreach). WhatsApp only delivers the **approved** template content.
- **Free text** — only works within the **24-hour window** after a customer last messaged you (WhatsApp policy). Outside that window it fails.
- Single send (`/send-message`) is immediate; bulk send (`/send-bulk`) is queued (see the queue section above).

### Webhooks (incoming messages & delivery status)
- Twilio/Meta call the backend when something happens:
  - **Incoming message** → `POST /api/webhook/twilio/message` (or Meta's `/api/webhook`)
  - **Status update** → `POST /api/webhook/twilio/status`
- The webhook controller validates the request signature (if enabled), then publishes an event on the event bus.
- Handlers in [`events/handlers/index.js`](backend/src/events/handlers/index.js) save the message/status to the DB, update the conversation, push it live to the frontend over the socket, and optionally send an auto-reply.

### Real-time (Socket.io)
- The backend emits events like `new_message`, `incoming_message`, `status_update`, `campaign_progress`, `campaign_update`, `campaign_complete`.
- The frontend ([`context/SocketContext.jsx`](frontend/src/context/SocketContext.jsx)) listens and updates the UI instantly (new chat messages, live campaign progress bars, delivery ticks).

### Campaigns & stats
- Each bulk send creates a campaign. The **Campaigns** page shows per-campaign counts (sent/delivered/read/failed) and per-message logs.
- The **Dashboard** shows totals and a delivery rate, computed from the `messages` table.

---

## 8. Database schema

Main tables (see [`backend/supabase_schema.sql`](backend/supabase_schema.sql) and [`backend/migrations.sql`](backend/migrations.sql)):

| Table | Purpose |
|---|---|
| `settings` | Key/value app settings (Twilio mode & creds, auto-reply, sending rate, webhook-verify toggle) |
| `contacts` | Contact records (phone, name, label, tags, is_active, is_important, soft-delete) |
| `campaigns` | One row per bulk send (name, template, counts, status) |
| `messages` | Every outbound/inbound message with its status and any error |
| `conversations` | One row per phone number — the latest message & unread count (powers the chat list) |
| `templates` | Your message templates + their Twilio Content SID + approval status |
| `jobs` | The background send queue (one row per recipient per campaign) |
| `opt_outs` | Phone numbers that opted out (never message these) |
| `media_assets` | Uploaded images/files and their public URLs |
| `audit_logs` | Change history (optional) |

**Relationships:** `messages.campaign_id → campaigns.id`, `jobs.campaign_id → campaigns.id`,
`conversations.phone → contacts.phone`. Phone number is the natural key that ties contacts,
conversations, and messages together (always stored in `+E.164` format).

**Important:** there's a SQL function `pull_pending_job()` that the worker relies on, and
`get_campaign_job_counts()` for fast campaign stats. These live in the schema/migration SQL —
if you set up a fresh database, run `supabase_schema.sql`, then `migrations.sql`, then
`migrations/003_enable_rls.sql`, then `migrations/004_message_media.sql` (stores sent images on
`messages.media_url` so they show in Chats), then `migrations/005_sending_safeguards.sql` (contact
consent and "not on WhatsApp" flags, campaign pause reasons, and two SQL helpers for the daily-limit
and cooldown checks), then `migrations/006_quiet_hours_override.sql`, then
`migrations/007_security_hardening.sql` (pins the SQL functions' `search_path`, stops the public API
keys calling them, and indexes `conversations.last_message_id`), then
`migrations/008_schema_catch_up.sql` (`templates.header_image_url`, and an index the campaign
worker uses to never message the same number twice in one campaign).

Unfinished drafts that must **not** be run live in `docs/drafts/`.

With RLS on, `SUPABASE_KEY` must be the **service_role / secret** key. The backend logs a warning
at startup if it's the anon / publishable key.

### Sending safeguards (protecting the number's quality rating)
- **Opt-outs:** an incoming STOP / UNSUBSCRIBE (or Meta's "Stop promotions" button) adds the number to
  `opt_outs`, deactivates the contact, cancels its queued campaign messages and sends a confirmation.
  START reverses it. Opted-out numbers are never sent campaign messages (`services/optOutService.js`).
- **Consent:** contacts carry `consent_status` / `consent_source`; imports and the Contacts page can
  record it, and Bulk send can be limited to consented contacts.
- **Every campaign goes through `controllers/bulkSendController.js`:** opt-outs blocked, contacts
  messaged within the cooldown skipped, start moved past quiet hours, and template campaigns split
  across days to respect the WhatsApp daily conversation limit. `POST /campaigns/preflight` shows the
  same result before sending.
- **Automatic pause:** `services/campaignControl.js` pauses a campaign on account/policy errors,
  persistent rate limits, or when 30%+ of its first 20+ messages fail. Campaigns can also be paused,
  resumed and cancelled from the UI.
- **Error categories** in `integrations/twilio/errors.js` drive all of this — e.g. 63049 (Meta held
  back a marketing message) is never retried quickly, and 63018 (rate limit) backs off.
- Limits, cooldowns and quiet hours are set in the app's Settings. An urgent campaign can skip quiet
  hours with **Send now anyway** in the send confirmation (`ignoreQuietHours`; stored on
  `campaigns.ignore_quiet_hours` by `migrations/006_quiet_hours_override.sql`).
- **Opt-outs apply to Chats too:** templates are never sent to an opted-out number, and a free-form
  reply is allowed only after the person writes again (`sendingPolicy.optOutBlockReason`).
- **No duplicate sends:** once WhatsApp accepts a message, later errors (saving it, updating the job)
  are logged, never retried. A campaign also checks it hasn't already reached a number before
  sending. Campaign jobs are queued on hold and released together, so a failed queueing sends nothing.

### Security & privacy
- **Sessions** last 12 hours. Signing out blocks that token on the server (`services/sessionService.js`).
- **Audit trail:** every change made through the API is written to `audit_logs`
  (`middleware/auditTrail.js`), plus sign-ins and sign-outs. Entries record which fields changed, never
  message text, phone lists or secrets.
- **Logs** never contain request bodies; phone numbers keep only their last 4 digits, message text is
  replaced by its length and secrets are hidden (`utils/logger.js`).
- **Saved credentials** (Twilio auth token etc.) are encrypted in the `settings` table with a key from
  `SETTINGS_ENCRYPTION_KEY` (or `JWT_SECRET`). Changing that key makes saved credentials unreadable:
  re-enter them in Settings.
- **Uploaded media** has to stay publicly downloadable (WhatsApp fetches it from the link), so files
  get random 128-bit names instead.
- **Webhook signatures** are always verified in production.
- **Data retention:** messages older than `messageRetentionDays` (Settings → Data, default 60) are
  deleted permanently, with conversations that have had no activity since
  (`services/retentionService.js`, run on start-up and every 12 hours). Contacts, campaigns and their
  totals, templates and the audit log are kept. Minimum 30 days (and never less than the campaign
  cooldown); 0 keeps everything. Campaign totals never go down when old records are removed.

---

## 9. WhatsApp providers (Twilio & Meta)

The app can send through **Twilio** or **Meta's WhatsApp Cloud API**. It picks automatically
([`services/whatsappService.js`](backend/src/services/whatsappService.js)):

1. If **Meta** is configured (`META_ACCESS_TOKEN` + `META_PHONE_NUMBER_ID`) → use Meta.
2. Else if **Twilio** is configured (Account SID starting `AC...`) → use Twilio.
3. Else → **simulation mode** (fakes a message ID, sends nothing — useful for dev, dangerous if you think it's really sending).

**This deployment uses Twilio.** Credentials are resolved like this (DB first, then env):
- The app reads Twilio credentials from the `settings` table **first** (entered via the in-app
  Settings panel), and falls back to the `TWILIO_*` **environment variables** if the setting is empty.
- **Sandbox vs Production mode:** Sandbox uses Twilio's shared test number (`+1 415 523 8886`) and
  only reaches test numbers that joined the sandbox. Production uses your real WhatsApp number.
  This deployment runs in **production** mode.

**Credential types (Twilio):**
- Account SID: starts with `AC`
- API Key SID: starts with `SK` (this deployment authenticates sending with an API Key + Secret)
- Auth Token: 32 hex chars, no prefix — **only** needed to verify incoming webhook signatures.

---

## 10. Environment variables

Set these on the **backend host (Render)**. See [`backend/.env.example`](backend/.env.example) for the full annotated list.

| Variable | Required? | What it's for |
|---|---|---|
| `JWT_SECRET` | ✅ (prod) | Signs admin login tokens. **The server won't start in production without it.** |
| `ADMIN_PASSWORD` | ✅ (prod) | The admin login password. |
| `SUPABASE_URL` | ✅ | Your Supabase project URL. |
| `SUPABASE_KEY` | ✅ | Supabase **service-role** key (server-side only — never expose it). |
| `FRONTEND_URL` | ✅ | Allowed browser origin(s) for CORS, e.g. `https://onegraspconnect.vercel.app`. Comma-separate multiple. |
| `NODE_ENV` | ✅ | `production` in prod. |
| `TWILIO_ACCOUNT_SID` | ✅ (Twilio) | `AC...` account SID. |
| `TWILIO_API_KEY` / `TWILIO_API_SECRET` | ✅ (Twilio) | API key auth for sending. |
| `TWILIO_AUTH_TOKEN` | ⚠️ | Needed to verify **incoming** Twilio webhooks (not for sending). |
| `TWILIO_WHATSAPP_NUMBER` | ✅ (Twilio) | Your WhatsApp sender, e.g. `whatsapp:+919876543210`. |
| `TWILIO_MODE` | ✅ (Twilio) | `production` or `sandbox`. |
| `TWILIO_MESSAGING_SERVICE_SID` | optional | If you use a Messaging Service (`MG...`). |
| `CRON_SECRET` | ⚠️ | Protects the `/api/jobs/process-queue` endpoint (needed only on serverless hosting). |
| `META_*` | optional | Only if using Meta instead of/alongside Twilio (`META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET`, etc.). |
| `DEFAULT_COUNTRY_CODE` | optional | Country code given to numbers written without one (default `91` = India): a leading `0`, or 10 digits or fewer. Numbers from any other country must include their country code (`+1 415…`) or use the import's Country Code column. Numbers starting with `+`/`00`, or longer than 10 digits, are kept as they are. |
| `SETTINGS_ENCRYPTION_KEY` | optional | Key for encrypting credentials saved in Settings. Defaults to `JWT_SECRET`. Set it if you ever plan to rotate `JWT_SECRET`. |
| `TRUST_PROXY_HOPS` | optional | Reverse proxies in front of the app (default `1`, right for Render). Set `2` if you add e.g. Cloudflare in front. |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta only | Required to verify a Meta webhook; there is no built-in default. |

**Frontend build-time variable (set on Vercel):**
| `VITE_API_URL` | The backend URL the frontend calls, e.g. `https://onegrasp-backend.onrender.com`. Must trigger a redeploy to take effect. |

---

## 11. Running it locally

**Prerequisites:** Node.js 18+, a Supabase project, Twilio (and/or Meta) credentials.

```bash
# 1. Backend
cd backend
cp .env.example .env        # then fill in the values
npm install
npm run dev                 # starts on http://localhost:5000 (nodemon)

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev                 # starts on http://localhost:5173
```

- The frontend dev server proxies `/api` to `http://localhost:5000` (see `vite.config.js`).
- For webhooks locally, expose the backend with a tunnel (e.g. `npx ngrok http 5000`) and point
  Twilio/Meta at the public URL.
- Database: run `supabase_schema.sql`, `migrations.sql`, then `migrations/003` to `migrations/008` in order, in the Supabase SQL editor first.
- Tests: `cd backend && npm test`. GitHub Actions (`.github/workflows/ci.yml`) runs the tests, the
  frontend build and a dependency audit on every push; a red ✗ means don't deploy.
- Browser tests: `cd frontend && npx playwright install chromium` (once), then `npm run test:e2e`
  (or `PW_CHANNEL=msedge npm run test:e2e` to use an installed Edge). They build the app and click
  through sign-in, contacts, chats, templates, bulk send, settings and every page on a phone screen,
  against a fake backend (`frontend/e2e/fakeApi.js`): no real data is touched and nothing is sent.
  Add a test there whenever you fix a bug, so it can't come back.
- Frontend toolchain: Vite 8, React Router 7, Tailwind CSS 4 (theme in `src/index.css`, no
  `tailwind.config.js`). Node 20.19+ or 22.12+ is needed to build.

---

## 12. Deployment & how to ship changes

This repo is connected to GitHub (`github.com/onegrasp/Onegrasp_whatsapp`). Hosting auto-deploys from the `main` branch:

- **Push to `main`** → Vercel rebuilds & redeploys the **frontend**, and Render rebuilds & redeploys the **backend**.
- **Environment variables** are set in each host's dashboard (Render for the backend, Vercel for frontend build vars) — **not** in the repo.

```bash
git add .
git commit -m "your change"
git push origin main
```

> If you change backend behavior that depends on a new env var, add it in the **Render** dashboard
> **before/with** the deploy, or the server may crash on boot or behave unexpectedly.

---

## 13. Important gotchas (read this!)

These are the non-obvious things that have caused real issues:

1. **Render free tier sleeps.** The backend spins down after ~15 min idle and takes **up to ~90 seconds**
   to wake on the next request. The first page load after idle looks like "Unable to connect."
   **Fix:** keep it awake with a free uptime pinger (e.g. UptimeRobot hitting
   `https://onegrasp-backend.onrender.com/health` every 5 min), or upgrade Render to a paid plan.

2. **CORS is an allowlist.** The backend only accepts browser requests from origins in `FRONTEND_URL`
   (or a small built-in default). If you add a new frontend domain, add it to `FRONTEND_URL` on Render,
   or the browser will show "Unable to connect." (Note: the live domain is `onegraspconnect` — singular.)

3. **The production backend URL is the default** in `frontend/src/lib/config.js`
   (`https://onegrasp-backend.onrender.com`). If you move the backend, set `VITE_API_URL` on Vercel
   **and** update `connect-src` in `frontend/vercel.json`, or the browser will block the new address.

4. **Templates with image + text + buttons** are built as a `whatsapp/card`, which keeps the body
   text (up to 1,024 characters). Media templates must have an image before they can be submitted.

5. **Free text only works within WhatsApp's 24-hour window.** For cold outreach you must use an
   **approved template**. WhatsApp always delivers the *approved* template content — not the preview
   shown in the app (the preview reads from this app's DB, which can differ from what's approved).

6. **Twilio account ownership.** The account that actually sends may be registered under
   a different email than you expect. Templates, the WhatsApp sender, and credentials all live in that
   specific account — you need access to **that** account to manage them.

7. **Webhook signature verification.** Twilio webhook verification needs `TWILIO_AUTH_TOKEN`
   (API keys can't verify signatures). Meta needs `META_APP_SECRET`. In production verification is
   always on; the Settings toggle only works in development.

8. **Background worker on serverless.** The queue worker runs in-process on an always-on host (Render).
   On a serverless host (Vercel) it does **not** run continuously — it needs the cron in `vercel.json`
   hitting `/api/jobs/process-queue` (protected by `CRON_SECRET`). This deployment's backend is on
   Render, so the in-process worker handles it.

9. **Phone numbers are always stored as `+E.164`.** Bare 10-digit numbers get the default country code
   (`91`) prepended. Change `DEFAULT_COUNTRY_CODE` for other countries.

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Unable to connect to server" on login | Render backend asleep (cold start) **or** your domain not in `FRONTEND_URL` | Wait ~90s / set up uptime pinger; verify `FRONTEND_URL` includes your exact domain |
| Login fails for everyone after a deploy | `JWT_SECRET` or `ADMIN_PASSWORD` missing on **Render** | Add them in the Render env (not Vercel) |
| Messages send but arrive with missing/cut text | Template built as media+buttons "card" | Rebuild the template in Meta WhatsApp Manager with a proper body |
| Free text fails to deliver | Outside the 24-hour window | Use an approved template instead |
| Incoming replies / receipts don't update | Webhook signature rejected, or webhook URL not configured in Twilio | Set `TWILIO_AUTH_TOKEN` + enable verification, or temporarily disable it in Settings; check Twilio webhook URLs |
| Bulk campaign stuck at "pending" | Worker not running (e.g. on serverless with no cron) | Ensure the backend runs the worker / cron hits `/api/jobs/process-queue` |
| Nothing actually sends but UI says "sent" | Running in **simulation mode** (no real Twilio/Meta creds) | Configure real credentials |

**Where to look:**
- Backend logs: Render dashboard → the service → Logs. The app also keeps recent logs in memory,
  viewable in the **Logs** page of the UI.
- DB: Supabase dashboard → Table editor / SQL editor.

---

## 15. Tests

Backend unit tests use Node's built-in test runner:

```bash
cd backend
npm test            # runs tests/*.test.js
```

They cover pure logic (error mappers, validators, template helpers, phone formatting, retry backoff,
and the template-truncation regression). There are no end-to-end/browser tests yet.

---

*Last updated during a codebase audit & onboarding handover. If something here no longer matches the
code, trust the code and update this file.*

# WA Bulk — WhatsApp Campaign Manager

A self-hosted WhatsApp bulk messaging system that sends via **Twilio** and/or the **Meta WhatsApp Cloud API**, backed by **Supabase (Postgres)**. Supports bulk campaigns, real-time chat, delivery tracking, and contact management.

> **Note:** Earlier revisions of this README described MongoDB and a Meta-only setup. The current stack is Supabase + Twilio/Meta — see the tables below.

---

## Features

- **Bulk Send** — Upload CSV contacts and send template or free-text messages in bulk
- **Real-Time Chat** — Two-way conversations with customers, live via Socket.io
- **Delivery Tracking** — Track sent → delivered → read → failed per message
- **Campaign Analytics** — Per-campaign stats and delivery rates
- **Contact Labels** — Tag contacts as Interested, Follow Up, Converted, Not Interested
- **Search** — Search contacts by name or phone

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | Supabase (Postgres) |
| Real-Time | Socket.io |
| Messaging | Twilio WhatsApp and/or Meta WhatsApp Cloud API |

---

## Prerequisites

1. **Node.js** v18+
2. **Supabase** project (run the SQL in `backend/supabase_schema.sql`, then `backend/migrations.sql`, then `backend/migrations/003_enable_rls.sql`, `backend/migrations/004_message_media.sql`, `backend/migrations/005_sending_safeguards.sql`, `backend/migrations/006_quiet_hours_override.sql`, `backend/migrations/007_security_hardening.sql` and `backend/migrations/008_schema_catch_up.sql`)
3. A WhatsApp sender: a **Twilio** account with WhatsApp enabled, and/or a **Meta Developer Account** with a WhatsApp Business App

---

## Setup Guide

### Step 1 — Clone and Install

```bash
git clone <your-repo>
cd whatsapp-system
npm run install:all
```

Or manually:

```bash
cd backend && npm install
cd ../frontend && npm install
```

---

### Step 2 — Meta WhatsApp Cloud API Setup

1. Go to https://developers.facebook.com
2. Create a **Business App**
3. Add the **WhatsApp** product
4. From the WhatsApp → Getting Started section, get:
   - **Temporary Access Token** (or generate a permanent one)
   - **Phone Number ID**
   - **WhatsApp Business Account ID (WABA ID)**

---

### Step 3 — Configure Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` — see [`backend/.env.example`](backend/.env.example) for the full, documented list. The security-critical variables are:

```env
# Required in production — the server refuses to start without these:
JWT_SECRET=<48+ random bytes; generate with node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
ADMIN_PASSWORD=<your admin console password>
CRON_SECRET=<random string; also used to authorize the queue cron>

# Database (use the Supabase SERVICE ROLE key server-side):
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=<supabase service role key>

# One or both providers:
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
META_ACCESS_TOKEN=...
META_PHONE_NUMBER_ID=...
META_APP_SECRET=<required to verify inbound Meta webhooks>
META_WEBHOOK_VERIFY_TOKEN=<your verify token>

FRONTEND_URL=http://localhost:5173
```

> **Security:** There are no default secrets. If `JWT_SECRET`/`ADMIN_PASSWORD` are unset the server will not start in production (and admin login is disabled in development). Set `META_APP_SECRET` so inbound Meta webhooks are signature-verified; Twilio webhook signature verification is on by default and can be toggled in Settings.

---

### Step 4 — Run Locally

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:5000

---

### Step 5 — Configure Webhook

Meta needs a **public URL** to send events (replies, delivery status) to your backend.

**During development** — use ngrok:
```bash
npx ngrok http 5000
```
Copy the HTTPS URL, e.g. `https://abc123.ngrok.io`
**In Meta Dashboard:**
1. Go to WhatsApp → Configuration
2. Set Webhook URL: `https://abc123.ngrok.io/api/webhook`
3. Set Verify Token: same value as `WEBHOOK_VERIFY_TOKEN` in your `.env`
4. Subscribe to: `messages`, `message_status`
---
### Step 6 — Create a Message Template

To send bulk messages to users who haven't messaged you first, you **must** use an approved template.

1. Go to WhatsApp Manager → Message Templates
2. Create a new template (e.g. name: `promo_intro`)
3. Submit for Meta approval (usually 1–24 hours)
4. Once approved, use the exact template name in the Bulk Send page
---
## CSV Upload Format
```csv
Name,Country Code,Phone
John Doe,91,9876543210
Alice Smith,91,9988877766
Jane Smith,1,4155238886
```
- **Country Code** is optional when the phone numbers already include it (e.g. `+919876543210` or `919876543210`)
- Spaces, dashes, dots, brackets and stray symbols in numbers are ignored
- In Excel, format the Phone column as **Text** before entering numbers. Numbers saved in scientific notation (e.g. `9.19E+11`) have lost digits and are rejected
- Numbers already in your contacts are reported, not duplicated or overwritten; duplicates inside the file are reported with their row numbers
- Column headers are case-insensitive (`name`, `Name`, `NAME` all work)
---
## API Reference
### Contacts
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/contacts/upload` | Upload CSV file |
| GET | `/api/contacts` | List contacts (search, label, page) |
| PATCH | `/api/contacts/:id/label` | Update contact label |
| DELETE | `/api/contacts/:id` | Delete contact |

### Messaging
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/send-bulk` | Send bulk campaign |
| POST | `/api/send-message` | Send single message |
| GET | `/api/templates` | Fetch approved Meta templates |

### Campaigns
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/campaigns` | List all campaigns |

### Chat
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/conversations` | All conversations (latest msg each) |
| GET | `/api/messages/:phone` | Messages for a phone number |
| GET | `/api/stats` | Dashboard stats |

### Webhook
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/webhook` | Meta webhook verification |
| POST | `/api/webhook` | Receive incoming events |

---

## Deployment

### Backend (Render / Railway)

1. Push backend to GitHub
2. Create new Web Service on Render
3. Set environment variables from `.env`
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Update `WEBHOOK_VERIFY_TOKEN` and configure Meta webhook with the public URL

### Frontend (Vercel)

1. Push frontend to GitHub
2. Import project on Vercel
3. Set environment variable:
   ```
   VITE_API_URL=https://your-backend.render.com
   ```
4. If the backend address isn't `https://onegrasp-backend.onrender.com`, also update `connect-src` in `frontend/vercel.json`

### Database (Supabase)

1. Create a Supabase project
2. Run `backend/supabase_schema.sql`, then `backend/migrations.sql`, then `backend/migrations/003_enable_rls.sql`, `backend/migrations/004_message_media.sql`, `backend/migrations/005_sending_safeguards.sql`, `backend/migrations/006_quiet_hours_override.sql`, `backend/migrations/007_security_hardening.sql` and `backend/migrations/008_schema_catch_up.sql` in the SQL editor
3. Copy the project URL to `SUPABASE_URL` and the **service role** key to `SUPABASE_KEY` (server-side only — never ship it to the browser)

### Background worker & serverless note

Bulk sends are queued to the `jobs` table and drained by a worker. On a long-running host (Render/Railway) the worker runs in-process. **On Vercel (serverless) the in-process worker does not run** — the included `vercel.json` registers a cron that calls `GET /api/jobs/process-queue` every minute. That endpoint requires `CRON_SECRET` (sent as `Authorization: Bearer <CRON_SECRET>`). Socket.io realtime also does not hold connections on serverless; use a long-running host if you need live updates.

---

## Important Notes

### Template vs Free Text

| Type | When to use |
|---|---|
| **Template** | Cold outreach — user has never messaged you, or last message > 24 hrs ago |
| **Free Text** | Active conversations — user messaged you within the last 24 hours |

Sending free text outside the 24-hour window will result in a failed message from Meta.

### Sending speed and limits

- Campaign messages go out at the **sending rate** set in Settings (default 2 per second, max 10).
- Template campaigns respect your WhatsApp **daily conversation limit** (set it in Settings) and are
  split across days when they would exceed it. Quiet hours hold messages overnight.
- A campaign can have up to 20,000 recipients; contact files are limited to 10 MB / 50,000 rows.

---

## Folder Structure

```
backend/
├── server.js                 # entry point (loads src/server.js)
├── supabase_schema.sql       # base schema
├── migrations.sql            # follow-up schema changes
├── migrations/               # numbered migrations 003–008, run in order
├── scripts/                  # manual maintenance scripts
├── tests/                    # node:test unit tests (npm test)
└── src/
    ├── config/               # env, Supabase client
    ├── controllers/          # HTTP handlers
    ├── events/               # event bus + webhook event handlers
    ├── integrations/         # Twilio and Meta clients, webhooks, error mapping
    ├── middleware/           # auth, audit trail, rate limits, request log
    ├── repositories/         # database access
    ├── routes/v1/            # API routes (mounted at /api/v1 and /api)
    ├── services/             # business logic (sending policy, sessions, templates…)
    ├── utils/                # logger, phone and CSV parsing, encryption
    ├── validators/           # request schemas
    └── workers/              # queue, campaign sender, retries, status and approval sync

frontend/
└── src/
    ├── pages/                # Dashboard, Bulk send, Chats, Contacts, Campaigns, Templates, Logs
    ├── components/           # app shell, dialogs, UI kit
    ├── context/              # live updates (Socket.io)
    ├── lib/                  # config, formatting, helpers
    └── services/api.js       # API client

docs/drafts/                  # unfinished designs — not to be run
.github/workflows/ci.yml      # tests, build and dependency audit on every push
```
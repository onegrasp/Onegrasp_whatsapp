# WA Bulk — WhatsApp Campaign Manager

A lightweight self-hosted WhatsApp bulk messaging system built with the Meta WhatsApp Cloud API. Supports bulk campaigns, real-time chat, delivery tracking, and contact management.

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
| Database | MongoDB + Mongoose |
| Real-Time | Socket.io |
| Messaging | Meta WhatsApp Cloud API |

---

## Prerequisites

1. **Node.js** v18+
2. **MongoDB Atlas** account (free tier works)
3. **Meta Developer Account** with a WhatsApp Business App

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

Edit `.env`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/whatsapp_system
ACCESS_TOKEN=your_meta_permanent_access_token
PHONE_NUMBER_ID=your_phone_number_id
WABA_ID=your_waba_id
WEBHOOK_VERIFY_TOKEN=any_secret_string_you_choose
FRONTEND_URL=http://localhost:5173
```

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
Name,Phone
John Doe,919876543210
Alice Smith,919988877766
Mike Johnson,919999888777
```
- Phone numbers must include **country code** (91 for India)
- No `+` prefix, no spaces or dashes
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
4. Update `vite.config.js` proxy target for production (or use env var in `api.js`)

### Database (MongoDB Atlas)

1. Create a free M0 cluster at mongodb.com
2. Create a database user
3. Whitelist `0.0.0.0/0` for IP access (or specific IPs)
4. Copy the connection string to `MONGODB_URI`

---

## Important Notes

### Template vs Free Text

| Type | When to use |
|---|---|
| **Template** | Cold outreach — user has never messaged you, or last message > 24 hrs ago |
| **Free Text** | Active conversations — user messaged you within the last 24 hours |

Sending free text outside the 24-hour window will result in a failed message from Meta.

### Rate Limits

- Meta allows **80 messages/second** on most tiers
- The system adds a 200ms delay between bulk sends to stay safe
- For very large lists (10,000+), consider batching into multiple campaigns

---

## Folder Structure

```
whatsapp-system/
├── backend/
│   ├── models/
│   │   ├── Contact.js
│   │   ├── Message.js
│   │   └── Campaign.js
│   ├── routes/
│   │   ├── contactRoutes.js
│   │   ├── sendRoutes.js
│   │   ├── webhookRoutes.js
│   │   └── chatRoutes.js
│   ├── controllers/
│   │   ├── sendController.js
│   │   └── webhookController.js
│   ├── services/
│   │   └── whatsappService.js
│   ├── utils/
│   │   └── csvParser.js
│   ├── server.js
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Dashboard.jsx
    │   │   ├── BulkSender.jsx
    │   │   ├── Chats.jsx
    │   │   ├── Contacts.jsx
    │   │   └── Campaigns.jsx
    │   ├── components/
    │   │   ├── Sidebar.jsx
    │   │   └── MessageBubble.jsx
    │   ├── context/
    │   │   └── SocketContext.jsx
    │   ├── services/
    │   │   └── api.js
    │   └── App.jsx
    └── package.json
```

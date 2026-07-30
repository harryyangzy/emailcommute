# Commute Mail (Email Prototype)

Minimal Node.js + TypeScript service that receives an inbound email via a Resend webhook and sends an automatic confirmation reply to the sender.

**This version only confirms that an email was received. It does not look up transit schedules, connect to Metrolinx, or parse commute requests.**

Status: end-to-end local test succeeded — inbound email via Resend webhook → confirmation reply out. Omg it worked.

## Features

- `POST /api/webhooks/inbound-email` — Resend inbound webhook
- `GET /api/health` — health check
- Webhook signature verification (Svix / Resend)
- Zod validation for environment variables and webhook payloads
- In-memory duplicate delivery protection
- Guards against self-replies and basic automated email loops
- Plain-text + HTML confirmation emails (HTML-escaped user content)

## Project structure

```text
src/
  app.ts
  server.ts
  config/
    env.ts
  routes/
    health.ts
    inbound-email.ts
  services/
    email-service.ts
  utils/
    clean-email-body.ts
    escape-html.ts
    is-automated-email.ts
  types/
    inbound-email.ts
tests/
  clean-email-body.test.ts
  inbound-email.test.ts
.env.example
package.json
tsconfig.json
README.md
```

## 1. Installation

Requires Node.js 20+.

```bash
npm install
```

Copy the example environment file:

```bash
cp .env.example .env
```

## 2. Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No (default `3000`) | HTTP port |
| `RESEND_API_KEY` | Yes | Resend API key used to send mail and fetch received email content |
| `RESEND_WEBHOOK_SECRET` | Yes | Signing secret from the Resend webhook (`whsec_...`) |
| `SERVICE_EMAIL_ADDRESS` | Yes | From address for replies (must be a verified Resend sender/domain) |
| `SERVICE_EMAIL_NAME` | No (default `Commute Mail`) | Display name used in the From header |

Example `.env`:

```env
PORT=3000
RESEND_API_KEY=re_xxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxx
SERVICE_EMAIL_ADDRESS=commute@yourdomain.com
SERVICE_EMAIL_NAME=Commute Mail
```

The app validates these variables with Zod on startup and exits if any required value is missing or invalid.

## 3. Running locally

Development (TypeScript via `tsx`):

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Health check:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "status": "ok" }
```

## 4. Running tests

```bash
npm test
```

Tests mock Resend and do not send real emails.

Typecheck:

```bash
npm run typecheck
```

## 5. Creating a Resend account

1. Sign up at [https://resend.com](https://resend.com).
2. Create an API key in the dashboard.
3. Store it as `RESEND_API_KEY`.

## 6. Configuring an inbound email domain

Resend receiving domains accept mail and emit `email.received` webhooks.

Options:

1. Use a Resend-managed receiving address shown under **Emails → Receiving**.
2. Or add a custom domain / subdomain and configure the Resend MX record.

Set `SERVICE_EMAIL_ADDRESS` to an address on that receiving/sending domain (for example `commute@yourdomain.com`).

> Note: Resend inbound webhooks include metadata only. This app calls the Receiving API (`emails.receiving.get`) to load the plain-text body and headers after verification.

## 7. Creating the inbound webhook

1. Open [https://resend.com/webhooks](https://resend.com/webhooks).
2. Click **Add Webhook**.
3. Set the endpoint URL to:

   ```text
   https://<your-public-host>/api/webhooks/inbound-email
   ```

4. Subscribe to the `email.received` event.
5. Copy the signing secret (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.

## 8. Testing the webhook locally with a tunnel

Your laptop is not publicly reachable, so expose the local server with a tunnel such as ngrok:

```bash
npm run dev
ngrok http 3000
```

Use the HTTPS URL ngrok prints, for example:

```text
https://abc123.ngrok-free.app/api/webhooks/inbound-email
```

Create or update the Resend webhook to that URL.

## 9. Sending a test email

Send mail to your Resend receiving address:

```text
To: commute@yourdomain.com
Subject: GO schedule
Body: Union to Unionville
```

You should receive a reply similar to:

```text
Subject: Re: GO schedule

Hi,

We received your commute request:

Union to Unionville

Transit schedule lookup is not available yet, but the email system is working.

Thanks,
Commute Mail
```

## 10. Deploying the server

1. Deploy the Node.js app to your host (Railway, Fly.io, Render, a VPS, etc.).
2. Set the same environment variables in the host’s secret store.
3. Ensure the process runs `npm run build && npm start` (or equivalent).
4. Point the Resend webhook at:

   ```text
   https://<your-production-host>/api/webhooks/inbound-email
   ```

5. Confirm `GET /api/health` returns `{ "status": "ok" }`.
6. Send a test email and verify the confirmation reply arrives.

### Production notes

- Replace the in-memory duplicate `Set` with persistent storage before multi-instance or production use.
- Keep request logs free of full email bodies and API keys (this prototype already avoids logging them).
- Only use verified Resend domains/addresses for sending.

## Example reply content

Plain text and HTML replies are both sent. Incoming content is cleaned (trim, quote/signature stripping, 1,000 character cap) and HTML-escaped before inclusion in the HTML part.

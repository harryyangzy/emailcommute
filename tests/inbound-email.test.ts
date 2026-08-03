import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Webhook } from 'svix';
import { createApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';
import type { EmailService } from '../src/services/email-service.js';
import type { MetrolinxService } from '../src/services/metrolinx-service.js';
import type { InboundEmailContent } from '../src/types/inbound-email.js';
import { buildHtmlBody } from '../src/services/email-service.js';
import { escapeHtml } from '../src/utils/escape-html.js';

// Valid Svix-format signing secret (same shape as Resend webhook secrets).
const WEBHOOK_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const testEnv: Env = {
  PORT: 3000,
  RESEND_API_KEY: 're_test_key',
  RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
  SERVICE_EMAIL_ADDRESS: 'commute@example.com',
  SERVICE_FROM_EMAIL: 'commute@example.com',
  SERVICE_EMAIL_NAME: 'Commute Mail',
  METROLINX_API_KEY: 'test_metrolinx_key',
  METROLINX_API_BASE_URL: 'https://api.openmetrolinx.com/OpenDataAPI',
  METROLINX_MAX_JOURNEYS: 4,
};

function createMockMetrolinxService(
  overrides: Partial<MetrolinxService> = {},
): MetrolinxService {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    resolveStation: vi.fn(),
    planJourney: vi.fn().mockResolvedValue({
      status: 'ok',
      from: { code: 'UN', name: 'Union Station' },
      to: { code: 'UI', name: 'Unionville GO' },
      date: '20260802',
      journeys: [
        {
          startTime: '07:20',
          endTime: '08:05',
          duration: '45 min',
          transferCount: 0,
          accessible: true,
          legs: [{ line: 'Stouffville', direction: 'NB', tripNumber: '123' }],
        },
      ],
    }),
    ...overrides,
  };
}

function signWebhookPayload(payload: string): {
  id: string;
  timestamp: string;
  signature: string;
} {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  const wh = new Webhook(WEBHOOK_SECRET);
  const signature = wh.sign(id, timestamp, payload);

  return {
    id,
    timestamp: Math.floor(timestamp.getTime() / 1000).toString(),
    signature,
  };
}

function buildWebhookBody(overrides: {
  emailId?: string;
  from?: string;
  to?: string[];
  subject?: string;
} = {}): string {
  return JSON.stringify({
    type: 'email.received',
    created_at: '2026-07-29T12:00:00.000Z',
    data: {
      email_id: overrides.emailId ?? 'email_123',
      created_at: '2026-07-29T12:00:00.000Z',
      from: overrides.from ?? 'rider@example.com',
      to: overrides.to ?? ['commute@example.com'],
      subject: overrides.subject ?? 'GO schedule',
      message_id: '<abc@example.com>',
      attachments: [],
    },
  });
}

function createMockEmailService(
  content: InboundEmailContent = {
    text: 'Union to Unionville',
    html: null,
    headers: {},
  },
): EmailService & {
  fetchInboundContent: ReturnType<typeof vi.fn>;
  sendConfirmation: ReturnType<typeof vi.fn>;
} {
  return {
    fetchInboundContent: vi.fn().mockResolvedValue(content),
    sendConfirmation: vi.fn().mockResolvedValue(undefined),
  };
}

async function postSignedWebhook(
  app: ReturnType<typeof createApp>,
  payload: string,
  headers?: Partial<{ id: string; timestamp: string; signature: string }>,
) {
  const signed = signWebhookPayload(payload);
  return request(app)
    .post('/api/webhooks/inbound-email')
    .set('Content-Type', 'application/json')
    .set('svix-id', headers?.id ?? signed.id)
    .set('svix-timestamp', headers?.timestamp ?? signed.timestamp)
    .set('svix-signature', headers?.signature ?? signed.signature)
    .send(payload);
}

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const app = createApp({
      env: testEnv,
      emailService: createMockEmailService(),
      metrolinxService: createMockMetrolinxService(),
    });

    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/webhooks/inbound-email', () => {
  let emailService: ReturnType<typeof createMockEmailService>;
  let metrolinxService: MetrolinxService;
  let processedMessageIds: Set<string>;

  beforeEach(() => {
    emailService = createMockEmailService();
    metrolinxService = createMockMetrolinxService();
    processedMessageIds = new Set<string>();
  });

  it('replies with the GO schedule for a normal inbound email', async () => {
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({ emailId: 'email_normal' });

    const response = await postSignedWebhook(app, payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(emailService.fetchInboundContent).toHaveBeenCalledWith('email_normal');
    expect(metrolinxService.planJourney).toHaveBeenCalledWith(
      'Union',
      'Unionville',
      expect.objectContaining({}),
    );
    expect(emailService.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(emailService.sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: 'rider@example.com',
        toName: null,
        originalSubject: 'GO schedule',
        reply: expect.objectContaining({
          kind: 'schedule',
          from: 'Union Station',
          to: 'Unionville GO',
        }),
      }),
    );
  });

  it('replies "unrecognized" when no route can be parsed', async () => {
    emailService = createMockEmailService({
      text: 'hello there, how are you?',
      html: null,
      headers: {},
    });
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({ emailId: 'email_unparseable', subject: 'hi' });

    const response = await postSignedWebhook(app, payload);

    expect(response.status).toBe(200);
    expect(metrolinxService.planJourney).not.toHaveBeenCalled();
    expect(emailService.sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: expect.objectContaining({ kind: 'unrecognized' }),
      }),
    );
  });

  it('replies "unavailable" when Metrolinx is not configured', async () => {
    metrolinxService = createMockMetrolinxService({
      isConfigured: vi.fn().mockReturnValue(false),
    });
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({ emailId: 'email_unconfigured' });

    const response = await postSignedWebhook(app, payload);

    expect(response.status).toBe(200);
    expect(metrolinxService.planJourney).not.toHaveBeenCalled();
    expect(emailService.sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: expect.objectContaining({ kind: 'unavailable' }),
      }),
    );

    const html = buildHtmlBody({ kind: 'unavailable', rawRequest: '' });
    expect(html).toContain(escapeHtml('No commute request was included.'));
  });

  it('does not send two replies for duplicate webhook deliveries', async () => {
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({ emailId: 'email_dup' });

    const first = await postSignedWebhook(app, payload);
    const second = await postSignedWebhook(app, payload);

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'ok' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'duplicate' });
    expect(emailService.sendConfirmation).toHaveBeenCalledTimes(1);
  });

  it('ignores emails from the service address', async () => {
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({
      emailId: 'email_self',
      from: 'commute@example.com',
    });

    const response = await postSignedWebhook(app, payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ignored',
      reason: 'service_address',
    });
    expect(emailService.sendConfirmation).not.toHaveBeenCalled();
  });

  it('ignores automated replies', async () => {
    emailService = createMockEmailService({
      text: 'I am out of the office',
      html: null,
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({
      emailId: 'email_ooo',
      subject: 'Out of Office',
    });

    const response = await postSignedWebhook(app, payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ignored', reason: 'automated' });
    expect(emailService.sendConfirmation).not.toHaveBeenCalled();
  });

  it('escapes HTML in the incoming body for the HTML reply', () => {
    const cleaned = '<script>alert("xss")</script>';
    const html = buildHtmlBody({ kind: 'unavailable', rawRequest: cleaned });
    expect(html).not.toContain('<script>');
    expect(html).toContain(escapeHtml(cleaned));
  });

  it('rejects invalid webhook signatures', async () => {
    const app = createApp({
      env: testEnv,
      emailService,
      metrolinxService,
      processedMessageIds,
    });
    const payload = buildWebhookBody({ emailId: 'email_bad_sig' });

    const response = await postSignedWebhook(app, payload, {
      id: 'msg_bad',
      timestamp: Math.floor(Date.now() / 1000).toString(),
      signature: 'v1,invalidsignature',
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid webhook signature' });
    expect(emailService.sendConfirmation).not.toHaveBeenCalled();
  });
});

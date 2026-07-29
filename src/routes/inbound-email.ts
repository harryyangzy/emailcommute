import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Webhook } from 'svix';
import type { Env } from '../config/env.js';
import type { EmailService } from '../services/email-service.js';
import { parseFromHeader } from '../services/email-service.js';
import { resendInboundWebhookSchema } from '../types/inbound-email.js';
import { cleanEmailBody } from '../utils/clean-email-body.js';
import { isAutomatedEmail } from '../utils/is-automated-email.js';

export interface InboundEmailRouteDeps {
  env: Env;
  emailService: EmailService;
  /**
   * In-memory set of provider message IDs already processed.
   * WARNING: This must be replaced with persistent storage (e.g. Redis or a
   * database) before production deployment. Process restarts lose this state
   * and multi-instance deployments will not share it.
   */
  processedMessageIds: Set<string>;
}

function extractRawBody(req: Request): string {
  const raw = req.body;
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (typeof raw === 'string') {
    return raw;
  }
  throw new Error('Expected raw request body for webhook verification');
}

function getSvixHeader(req: Request, name: string): string {
  const value = req.headers[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required webhook header: ${name}`);
}

function extractEmailAddress(value: string): string {
  return parseFromHeader(value).email;
}

export function createInboundEmailHandler(
  deps: InboundEmailRouteDeps,
): RequestHandler {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      await handleInboundEmail(deps, req, res);
    } catch (error) {
      console.error('Unhandled inbound webhook error', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

async function handleInboundEmail(
  deps: InboundEmailRouteDeps,
  req: Request,
  res: Response,
): Promise<void> {
  let rawBody: string;

  try {
    rawBody = extractRawBody(req);
  } catch {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  let verifiedPayload: unknown;
  try {
    const wh = new Webhook(deps.env.RESEND_WEBHOOK_SECRET);
    verifiedPayload = wh.verify(rawBody, {
      'svix-id': getSvixHeader(req, 'svix-id'),
      'svix-timestamp': getSvixHeader(req, 'svix-timestamp'),
      'svix-signature': getSvixHeader(req, 'svix-signature'),
    });
  } catch (error) {
    console.warn('Webhook signature verification failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const parsed = resendInboundWebhookSchema.safeParse(verifiedPayload);
  if (!parsed.success) {
    console.warn('Ignoring unsupported or invalid webhook payload', {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
    // Acknowledge so Resend does not endlessly retry non-inbound events.
    res.status(200).json({ status: 'ignored', reason: 'unsupported_event' });
    return;
  }

  const event = parsed.data;
  const providerMessageId = event.data.email_id;
  const fromParsed = parseFromHeader(event.data.from);
  const fromEmail = fromParsed.email;
  const toEmail = extractEmailAddress(event.data.to[0] ?? '');
  const subject = event.data.subject ?? '';

  console.info('Inbound email webhook received', {
    providerMessageId,
    fromEmail,
    toEmail,
    subjectLength: subject.length,
  });

  if (deps.processedMessageIds.has(providerMessageId)) {
    console.info('Duplicate webhook delivery ignored', { providerMessageId });
    res.status(200).json({ status: 'duplicate' });
    return;
  }

  if (fromEmail === deps.env.SERVICE_EMAIL_ADDRESS) {
    console.info('Ignoring email from service address', { providerMessageId });
    deps.processedMessageIds.add(providerMessageId);
    res.status(200).json({ status: 'ignored', reason: 'service_address' });
    return;
  }

  let content;
  try {
    content = await deps.emailService.fetchInboundContent(providerMessageId);
  } catch (error) {
    console.error('Failed to fetch inbound email content', {
      providerMessageId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    res.status(502).json({ error: 'Failed to fetch email content' });
    return;
  }

  const fromName =
    fromParsed.name
    ?? (() => {
      const fromHeader = content.headers['from'] ?? content.headers['From'];
      return fromHeader ? parseFromHeader(fromHeader).name : null;
    })();

  if (
    isAutomatedEmail({
      subject,
      fromEmail,
      headers: content.headers,
    })
  ) {
    console.info('Ignoring automated email', { providerMessageId, fromEmail });
    deps.processedMessageIds.add(providerMessageId);
    res.status(200).json({ status: 'ignored', reason: 'automated' });
    return;
  }

  const cleanedBody = cleanEmailBody(content.text ?? '');

  // Mark as processed before sending to reduce duplicate-reply risk if the
  // provider retries while a send is in flight. If send fails, remove so a
  // later retry can attempt again.
  deps.processedMessageIds.add(providerMessageId);

  try {
    await deps.emailService.sendConfirmation({
      toEmail: fromEmail,
      toName: fromName,
      originalSubject: subject,
      cleanedBody,
    });
  } catch (error) {
    deps.processedMessageIds.delete(providerMessageId);
    console.error('Failed to send confirmation email', {
      providerMessageId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    res.status(502).json({ error: 'Failed to send confirmation email' });
    return;
  }

  console.info('Confirmation email sent', {
    providerMessageId,
    toEmail: fromEmail,
  });
  res.status(200).json({ status: 'ok' });
}

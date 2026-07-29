import { Resend } from 'resend';
import type { Env } from '../config/env.js';
import type { InboundEmailContent } from '../types/inbound-email.js';
import { escapeHtml } from '../utils/escape-html.js';

export interface SendConfirmationParams {
  toEmail: string;
  toName: string | null;
  originalSubject: string;
  cleanedBody: string;
}

export interface EmailService {
  fetchInboundContent(emailId: string): Promise<InboundEmailContent>;
  sendConfirmation(params: SendConfirmationParams): Promise<void>;
}

function buildReplySubject(originalSubject: string): string {
  const trimmed = originalSubject.trim();
  if (!trimmed) {
    return 'We received your commute request';
  }
  if (/^re:/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

function buildPlainTextBody(cleanedBody: string): string {
  const requestText =
    cleanedBody.length > 0 ? cleanedBody : 'No commute request was included.';

  return [
    'Hi,',
    '',
    'We received your commute request:',
    '',
    requestText,
    '',
    'Transit schedule lookup is not available yet, but the email system is working.',
    '',
    'Thanks,',
    'Commute Mail',
  ].join('\n');
}

function buildHtmlBody(cleanedBody: string): string {
  const requestText =
    cleanedBody.length > 0 ? cleanedBody : 'No commute request was included.';
  const escapedRequest = escapeHtml(requestText).replaceAll('\n', '<br />');

  return [
    '<p>Hi,</p>',
    '<p>We received your commute request:</p>',
    `<p>${escapedRequest}</p>`,
    '<p>Transit schedule lookup is not available yet, but the email system is working.</p>',
    '<p>Thanks,<br />Commute Mail</p>',
  ].join('\n');
}

function parseFromHeader(from: string): { email: string; name: string | null } {
  const match = from.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim() || null;
    const email = match[2].trim().toLowerCase();
    return { email, name };
  }
  return { email: from.trim().toLowerCase(), name: null };
}

export function createEmailService(env: Env, resendClient?: Resend): EmailService {
  const resend = resendClient ?? new Resend(env.RESEND_API_KEY);

  return {
    async fetchInboundContent(emailId: string): Promise<InboundEmailContent> {
      const { data, error } = await resend.emails.receiving.get(emailId);

      if (error || !data) {
        throw new Error(
          `Failed to fetch inbound email content for id=${emailId}: ${error?.message ?? 'unknown error'}`,
        );
      }

      return {
        text: data.text,
        html: data.html,
        headers: data.headers ?? {},
      };
    },

    async sendConfirmation(params: SendConfirmationParams): Promise<void> {
      const subject = buildReplySubject(params.originalSubject);
      const text = buildPlainTextBody(params.cleanedBody);
      const html = buildHtmlBody(params.cleanedBody);

      const to =
        params.toName && params.toName.length > 0
          ? `${params.toName} <${params.toEmail}>`
          : params.toEmail;

      const { error } = await resend.emails.send({
        from: `${env.SERVICE_EMAIL_NAME} <${env.SERVICE_EMAIL_ADDRESS}>`,
        to: [to],
        subject,
        text,
        html,
      });

      if (error) {
        throw new Error(`Failed to send confirmation email: ${error.message}`);
      }
    },
  };
}

export { buildReplySubject, buildPlainTextBody, buildHtmlBody, parseFromHeader };

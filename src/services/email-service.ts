import { Resend } from 'resend';
import type { Env } from '../config/env.js';
import type { InboundEmailContent } from '../types/inbound-email.js';
import type { NormalizedJourney } from '../types/metrolinx.js';
import { escapeHtml } from '../utils/escape-html.js';

/**
 * A resolved outcome for a rider's request, ready to be rendered into an email.
 */
export type ScheduleReply =
  | {
      kind: 'schedule';
      from: string;
      to: string;
      date: string;
      journeys: NormalizedJourney[];
    }
  | { kind: 'no_service'; from: string; to: string; date: string }
  | { kind: 'station_not_found'; query: string; suggestions: string[] }
  | { kind: 'unrecognized'; rawRequest: string }
  | { kind: 'unavailable'; rawRequest: string };

export interface SendConfirmationParams {
  toEmail: string;
  toName: string | null;
  originalSubject: string;
  reply: ScheduleReply;
}

export interface EmailService {
  fetchInboundContent(emailId: string): Promise<InboundEmailContent>;
  sendConfirmation(params: SendConfirmationParams): Promise<void>;
}

function buildReplySubject(originalSubject: string, reply: ScheduleReply): string {
  const trimmed = originalSubject.trim();
  const base =
    reply.kind === 'schedule'
      ? `GO schedule: ${reply.from} → ${reply.to}`
      : trimmed || 'Your commute request';

  if (/^re:/i.test(base)) {
    return base;
  }
  return `Re: ${base}`;
}

/** yyyymmdd → "Sunday, Aug 2". Falls back to the raw value on parse failure. */
function formatDate(yyyymmdd: string): string {
  const match = yyyymmdd.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return yyyymmdd;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return yyyymmdd;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Pull a clock time (HH:MM) out of a Metrolinx time/datetime string. */
function formatTime(value: string): string {
  // Prefer a clock time that is NOT part of a date (avoid "2026-08-02").
  const match = value.match(/(?:^|\s)(\d{1,2}:\d{2})(?::\d{2})?/);
  if (match) return match[1];
  const fallback = value.match(/(\d{1,2}:\d{2})/);
  return fallback ? fallback[1] : value.trim();
}

/**
 * Turn a Metrolinx duration ("HH:MM:SS" or "MM:SS") into something readable
 * like "44 min" or "1 h 12 min". Returns the raw value if it can't parse.
 */
function formatDuration(value: string): string {
  const hms = value.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/);
  if (hms) {
    const hours = Number(hms[1]);
    const minutes = Number(hms[2]);
    if (hours === 0) return `${minutes} min`;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const ms = value.match(/^(\d{1,3}):([0-5]\d)$/);
  if (ms) {
    return `${Number(ms[1])} min`;
  }
  return value.trim();
}

function describeTransfers(journey: NormalizedJourney): string {
  if (journey.transferCount <= 0) return 'direct';
  return journey.transferCount === 1
    ? '1 transfer'
    : `${journey.transferCount} transfers`;
}

function describeLines(journey: NormalizedJourney): string {
  const lines = journey.legs.map((leg) => leg.line).filter(Boolean);
  return lines.length > 0 ? lines.join(' → ') : 'GO Transit';
}

function formatJourneyText(journey: NormalizedJourney): string {
  const start = formatTime(journey.startTime);
  const end = formatTime(journey.endTime);
  const bits = [describeLines(journey), describeTransfers(journey)];
  if (journey.duration) bits.push(formatDuration(journey.duration));
  if (journey.accessible) bits.push('accessible');
  return `${start} → ${end}  (${bits.join(', ')})`;
}

function buildPlainTextBody(reply: ScheduleReply): string {
  const footer = ['', 'Thanks,', 'Commute Mail'];

  switch (reply.kind) {
    case 'schedule': {
      const header = [
        'Hi,',
        '',
        `Next GO departures from ${reply.from} to ${reply.to} on ${formatDate(reply.date)}:`,
        '',
      ];
      const rows = reply.journeys.map(
        (journey, index) => `${index + 1}. ${formatJourneyText(journey)}`,
      );
      return [...header, ...rows, ...footer].join('\n');
    }
    case 'no_service':
      return [
        'Hi,',
        '',
        `We couldn't find any upcoming GO trips from ${reply.from} to ${reply.to} on ${formatDate(reply.date)}.`,
        'There may be no more service today — try again with a different time or date.',
        ...footer,
      ].join('\n');
    case 'station_not_found': {
      const suggestionText =
        reply.suggestions.length > 0
          ? `Did you mean: ${reply.suggestions.join(', ')}?`
          : 'Please check the station name and try again.';
      return [
        'Hi,',
        '',
        `We couldn't find a GO station matching "${reply.query}".`,
        suggestionText,
        '',
        'Reply with your trip like: "Union to Oakville".',
        ...footer,
      ].join('\n');
    }
    case 'unrecognized':
      return [
        'Hi,',
        '',
        "We couldn't read a trip from your message.",
        'Send your route like: "Union to Oakville" (optionally add a time, e.g. "Union to Oakville at 5:30pm").',
        ...footer,
      ].join('\n');
    case 'unavailable':
      return [
        'Hi,',
        '',
        'We received your commute request:',
        '',
        reply.rawRequest || 'No commute request was included.',
        '',
        'Schedule lookup is not configured yet (missing Metrolinx API key), but the email system is working.',
        ...footer,
      ].join('\n');
  }
}

function buildHtmlBody(reply: ScheduleReply): string {
  const footer = '<p>Thanks,<br />Commute Mail</p>';

  switch (reply.kind) {
    case 'schedule': {
      const rows = reply.journeys
        .map((journey) => {
          const start = escapeHtml(formatTime(journey.startTime));
          const end = escapeHtml(formatTime(journey.endTime));
          const detail = escapeHtml(
            [
              describeLines(journey),
              describeTransfers(journey),
              journey.duration ? formatDuration(journey.duration) : '',
              journey.accessible ? 'accessible' : '',
            ]
              .filter(Boolean)
              .join(', '),
          );
          return `<li><strong>${start} → ${end}</strong> <span style="color:#555">(${detail})</span></li>`;
        })
        .join('\n');
      return [
        '<p>Hi,</p>',
        `<p>Next GO departures from <strong>${escapeHtml(reply.from)}</strong> to <strong>${escapeHtml(
          reply.to,
        )}</strong> on ${escapeHtml(formatDate(reply.date))}:</p>`,
        `<ol>${rows}</ol>`,
        footer,
      ].join('\n');
    }
    case 'no_service':
      return [
        '<p>Hi,</p>',
        `<p>We couldn't find any upcoming GO trips from <strong>${escapeHtml(
          reply.from,
        )}</strong> to <strong>${escapeHtml(reply.to)}</strong> on ${escapeHtml(
          formatDate(reply.date),
        )}.</p>`,
        '<p>There may be no more service today — try again with a different time or date.</p>',
        footer,
      ].join('\n');
    case 'station_not_found': {
      const suggestionText =
        reply.suggestions.length > 0
          ? `Did you mean: ${escapeHtml(reply.suggestions.join(', '))}?`
          : 'Please check the station name and try again.';
      return [
        '<p>Hi,</p>',
        `<p>We couldn't find a GO station matching "${escapeHtml(reply.query)}".</p>`,
        `<p>${suggestionText}</p>`,
        '<p>Reply with your trip like: <em>Union to Oakville</em>.</p>',
        footer,
      ].join('\n');
    }
    case 'unrecognized':
      return [
        '<p>Hi,</p>',
        "<p>We couldn't read a trip from your message.</p>",
        '<p>Send your route like: <em>Union to Oakville</em> (optionally add a time, e.g. <em>Union to Oakville at 5:30pm</em>).</p>',
        footer,
      ].join('\n');
    case 'unavailable': {
      const escaped = escapeHtml(
        reply.rawRequest || 'No commute request was included.',
      ).replaceAll('\n', '<br />');
      return [
        '<p>Hi,</p>',
        '<p>We received your commute request:</p>',
        `<p>${escaped}</p>`,
        '<p>Schedule lookup is not configured yet (missing Metrolinx API key), but the email system is working.</p>',
        footer,
      ].join('\n');
    }
  }
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
      const subject = buildReplySubject(params.originalSubject, params.reply);
      const text = buildPlainTextBody(params.reply);
      const html = buildHtmlBody(params.reply);

      const to =
        params.toName && params.toName.length > 0
          ? `${params.toName} <${params.toEmail}>`
          : params.toEmail;

      const { error } = await resend.emails.send({
        from: `${env.SERVICE_EMAIL_NAME} <${env.SERVICE_FROM_EMAIL}>`,
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

export {
  buildReplySubject,
  buildPlainTextBody,
  buildHtmlBody,
  parseFromHeader,
  formatTime,
  formatDate,
  formatDuration,
};

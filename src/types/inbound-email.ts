import { z } from 'zod';

/**
 * Resend `email.received` webhook payload (metadata only).
 * Plain-text body must be fetched via the Receiving API.
 */
export const resendInboundWebhookSchema = z.object({
  type: z.literal('email.received'),
  created_at: z.string().optional(),
  data: z.object({
    email_id: z.string().min(1),
    created_at: z.string().optional(),
    from: z.string().min(1),
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().optional().default(''),
    message_id: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

export type ResendInboundWebhook = z.infer<typeof resendInboundWebhookSchema>;

export interface InboundEmailContent {
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
}

export interface ParsedInboundEmail {
  providerMessageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  textBody: string;
}

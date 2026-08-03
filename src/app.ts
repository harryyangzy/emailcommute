import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import type { Env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import {
  createInboundEmailHandler,
  type InboundEmailRouteDeps,
} from './routes/inbound-email.js';
import { createEmailService, type EmailService } from './services/email-service.js';
import {
  createMetrolinxService,
  type MetrolinxService,
} from './services/metrolinx-service.js';

const MAX_JSON_BODY_BYTES = 100 * 1024; // 100 KB for non-webhook JSON
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024; // 256 KB raw webhook payloads

export interface CreateAppOptions {
  env: Env;
  emailService?: EmailService;
  metrolinxService?: MetrolinxService;
  processedMessageIds?: Set<string>;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const emailService = options.emailService ?? createEmailService(options.env);
  const metrolinxService =
    options.metrolinxService ?? createMetrolinxService(options.env);
  const processedMessageIds = options.processedMessageIds ?? new Set<string>();

  const inboundDeps: InboundEmailRouteDeps = {
    env: options.env,
    emailService,
    metrolinxService,
    processedMessageIds,
  };

  // Raw body required for Svix/Resend webhook signature verification.
  app.post(
    '/api/webhooks/inbound-email',
    express.raw({ type: '*/*', limit: MAX_WEBHOOK_BODY_BYTES }),
    createInboundEmailHandler(inboundDeps),
  );

  app.use(express.json({ limit: MAX_JSON_BODY_BYTES }));
  app.use('/api', healthRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      if (
        typeof error === 'object'
        && error !== null
        && 'type' in error
        && (error as { type?: string }).type === 'entity.too.large'
      ) {
        res.status(413).json({ error: 'Request body too large' });
        return;
      }

      console.error('Unhandled application error', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      res.status(500).json({ error: 'Internal server error' });
    },
  );

  return app;
}

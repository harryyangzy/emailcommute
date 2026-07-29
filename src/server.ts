import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = createApp({ env });

const server = app.listen(env.PORT, () => {
  console.info('Commute Mail server listening', {
    port: env.PORT,
    serviceEmail: env.SERVICE_EMAIL_ADDRESS,
  });
});

function shutdown(signal: string): void {
  console.info('Shutting down', { signal });
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((port) => Number.isInteger(port) && port > 0 && port < 65536, {
      message: 'PORT must be a valid TCP port number',
    }),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_WEBHOOK_SECRET: z.string().min(1, 'RESEND_WEBHOOK_SECRET is required'),
  SERVICE_EMAIL_ADDRESS: z
    .string()
    .email('SERVICE_EMAIL_ADDRESS must be a valid email address')
    .transform((value) => value.toLowerCase()),
  // Optional outbound From address. Defaults to SERVICE_EMAIL_ADDRESS.
  // Use this when the receiving domain cannot send (e.g. *.resend.app).
  SERVICE_FROM_EMAIL: z
    .string()
    .email('SERVICE_FROM_EMAIL must be a valid email address')
    .optional()
    .transform((value) => value?.toLowerCase()),
  SERVICE_EMAIL_NAME: z.string().min(1).default('Commute Mail'),
});

export type Env = Omit<z.infer<typeof envSchema>, 'SERVICE_FROM_EMAIL'> & {
  SERVICE_FROM_EMAIL: string;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return {
    ...parsed.data,
    SERVICE_FROM_EMAIL:
      parsed.data.SERVICE_FROM_EMAIL ?? parsed.data.SERVICE_EMAIL_ADDRESS,
  };
}

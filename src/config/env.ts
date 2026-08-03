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
  // Metrolinx Open Data (GO Transit) API key. Optional: when missing, the
  // service still replies but explains that schedule lookup is not configured.
  // Register at https://api.openmetrolinx.com/OpenDataAPI/Help/Registration/en
  METROLINX_API_KEY: z.string().min(1).optional(),
  METROLINX_API_BASE_URL: z
    .string()
    .url('METROLINX_API_BASE_URL must be a valid URL')
    .default('https://api.openmetrolinx.com/OpenDataAPI')
    // Trim any trailing slash so path joining is predictable.
    .transform((value) => value.replace(/\/+$/, '')),
  METROLINX_MAX_JOURNEYS: z
    .string()
    .default('4')
    .transform((value) => Number.parseInt(value, 10))
    .refine((n) => Number.isInteger(n) && n > 0 && n <= 10, {
      message: 'METROLINX_MAX_JOURNEYS must be an integer between 1 and 10',
    }),
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

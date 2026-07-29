const MAX_BODY_LENGTH = 1_000;

const QUOTE_PATTERNS: RegExp[] = [
  /^On .+ wrote:\s*$/i,
  /^From:\s+/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^_{5,}\s*$/,
];

const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/,
  /^Sent from my iPhone\s*$/i,
  /^Sent from my Android\s*$/i,
  /^Get Outlook for (iOS|Android)\s*$/i,
];

/**
 * Trim, strip quoted replies / common signatures, and cap length.
 * Intentionally simple — not a full email parser.
 */
export function cleanEmailBody(rawBody: string): string {
  const lines = rawBody.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    if (QUOTE_PATTERNS.some((pattern) => pattern.test(line.trim()))) {
      break;
    }
    if (SIGNATURE_PATTERNS.some((pattern) => pattern.test(line.trim()))) {
      break;
    }
    kept.push(line);
  }

  let cleaned = kept.join('\n').trim();

  if (cleaned.length > MAX_BODY_LENGTH) {
    cleaned = cleaned.slice(0, MAX_BODY_LENGTH).trimEnd();
  }

  return cleaned;
}

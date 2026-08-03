/**
 * Parse a free-text commute request into an origin, destination and optional
 * departure time. Intentionally forgiving — riders write these by hand.
 *
 * Supported shapes (case-insensitive):
 *   "Union to Unionville"
 *   "from Union to Unionville"
 *   "Union -> Unionville"
 *   "Union - Unionville"
 *   "Union to Unionville at 5:30pm"
 *   "Union to Unionville 1730"
 */

export interface ParsedCommuteRequest {
  from: string;
  to: string;
  /** HHMM (24h) if a time was found, otherwise null (caller uses "now"). */
  startTime: string | null;
}

const SEPARATORS = [
  /\s+to\s+/i,
  /\s*->\s*/,
  /\s*→\s*/,
  /\s*-\s*/,
  /\s*—\s*/,
];

/** Extract a HHMM time from text, returning the time and the leftover text. */
function extractTime(input: string): { time: string | null; rest: string } {
  // 12h with am/pm, e.g. "5pm", "5:30 pm", "at 5:30 pm".
  const ampm = input.match(
    /\b(?:at\s+)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i,
  );
  if (ampm) {
    let hour = Number.parseInt(ampm[1], 10);
    const minute = ampm[2] ? Number.parseInt(ampm[2], 10) : 0;
    const isPm = ampm[3].toLowerCase() === 'p';
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return {
      time: `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`,
      rest: input.replace(ampm[0], ' ').trim(),
    };
  }

  // 24h "at 17:30" / "17:30" / "at 1730".
  const explicit = input.match(/\bat\s+([01]?\d|2[0-3]):?([0-5]\d)\b/i);
  if (explicit) {
    return {
      time: `${explicit[1].padStart(2, '0')}${explicit[2]}`,
      rest: input.replace(explicit[0], ' ').trim(),
    };
  }

  const bare = input.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  if (bare) {
    return {
      time: `${bare[1]}${bare[2]}`,
      rest: input.replace(bare[0], ' ').trim(),
    };
  }

  return { time: null, rest: input };
}

// Polite filler riders commonly append; safe to strip from a station endpoint.
const TRAILING_NOISE =
  /\s+(please|pls|plz|thanks|thank\s+you|thx|asap|now|today|tonight|tmrw|tomorrow)$/i;

function cleanEndpoint(value: string): string {
  let cleaned = value
    .replace(/^(from|leaving|departing|going|to)\s+/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();

  // Strip one or more trailing courtesy words (e.g. "Milton please, thanks").
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(TRAILING_NOISE, '').replace(/[.,;:!?]+$/g, '').trim();
  } while (cleaned !== previous);

  return cleaned;
}

function tryParseLine(line: string): ParsedCommuteRequest | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Ignore obvious noise lines that don't describe a route.
  if (trimmed.length > 120) return null;

  const { time, rest } = extractTime(trimmed);
  const withoutLead = rest.replace(/^(go\s+schedule|schedule|route|trip)\s*[:\-]?\s*/i, '');

  for (const separator of SEPARATORS) {
    const parts = withoutLead.split(separator);
    if (parts.length === 2) {
      const from = cleanEndpoint(parts[0]);
      const to = cleanEndpoint(parts[1]);
      if (from && to) {
        return { from, to, startTime: time };
      }
    }
  }

  return null;
}

/**
 * Parse a commute request from the email body, falling back to the subject.
 * Scans line by line so signatures/extra prose don't break detection.
 */
export function parseCommuteRequest(
  body: string,
  subject = '',
): ParsedCommuteRequest | null {
  const candidates = [
    ...body.split('\n'),
    subject,
  ];

  for (const candidate of candidates) {
    const parsed = tryParseLine(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

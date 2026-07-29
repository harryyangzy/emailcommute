export interface AutomatedEmailSignals {
  subject: string;
  fromEmail: string;
  headers: Record<string, string>;
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

/**
 * Detect out-of-office, bounce, and other auto-generated mail to avoid loops.
 */
export function isAutomatedEmail(signals: AutomatedEmailSignals): boolean {
  const autoSubmitted = getHeader(signals.headers, 'auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return true;
  }

  const precedence = getHeader(signals.headers, 'precedence');
  if (precedence) {
    const value = precedence.toLowerCase();
    if (value === 'bulk' || value === 'junk' || value === 'list' || value === 'auto_reply') {
      return true;
    }
  }

  const xAutoRespond = getHeader(signals.headers, 'x-autoreply')
    ?? getHeader(signals.headers, 'x-autorespond')
    ?? getHeader(signals.headers, 'x-auto-response-suppress');
  if (xAutoRespond) {
    return true;
  }

  const fromLower = signals.fromEmail.toLowerCase();
  const automatedSenders = [
    'mailer-daemon@',
    'postmaster@',
    'noreply@',
    'no-reply@',
    'donotreply@',
    'do-not-reply@',
  ];
  if (automatedSenders.some((prefix) => fromLower.startsWith(prefix) || fromLower.includes(`<${prefix}`))) {
    return true;
  }

  const subjectLower = signals.subject.toLowerCase();
  const automatedSubjects = [
    'out of office',
    'automatic reply',
    'auto-reply',
    'autoreply',
    'delivery status notification',
    'undeliverable',
    'delivery failure',
    'mail delivery failed',
    'returned mail',
    'failure notice',
  ];

  return automatedSubjects.some((phrase) => subjectLower.includes(phrase));
}

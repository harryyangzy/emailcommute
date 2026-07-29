import { describe, expect, it } from 'vitest';
import { cleanEmailBody } from '../src/utils/clean-email-body.js';

describe('cleanEmailBody', () => {
  it('trims whitespace', () => {
    expect(cleanEmailBody('  Union to Unionville  \n')).toBe('Union to Unionville');
  });

  it('truncates long bodies to 1000 characters', () => {
    const longBody = 'a'.repeat(1500);
    const cleaned = cleanEmailBody(longBody);
    expect(cleaned.length).toBe(1000);
    expect(cleaned).toBe('a'.repeat(1000));
  });

  it('removes quoted reply sections beginning with On ... wrote:', () => {
    const body = [
      'Union to Unionville',
      '',
      'On Mon, Jan 1, 2024 at 9:00 AM Alice wrote:',
      '> previous message',
    ].join('\n');

    expect(cleanEmailBody(body)).toBe('Union to Unionville');
  });

  it('removes quoted reply sections beginning with From:', () => {
    const body = ['Please look up my train', '', 'From: bob@example.com', 'Subject: old'].join(
      '\n',
    );
    expect(cleanEmailBody(body)).toBe('Please look up my train');
  });

  it('removes -----Original Message----- sections', () => {
    const body = [
      'Oakville to Union',
      '',
      '-----Original Message-----',
      'Earlier text',
    ].join('\n');
    expect(cleanEmailBody(body)).toBe('Oakville to Union');
  });

  it('removes common signature separators', () => {
    const withDashes = ['Union to Ajax', '', '--', 'Alice'].join('\n');
    expect(cleanEmailBody(withDashes)).toBe('Union to Ajax');

    const withIphone = ['Union to Ajax', '', 'Sent from my iPhone'].join('\n');
    expect(cleanEmailBody(withIphone)).toBe('Union to Ajax');

    const withAndroid = ['Union to Ajax', '', 'Sent from my Android'].join('\n');
    expect(cleanEmailBody(withAndroid)).toBe('Union to Ajax');
  });
});

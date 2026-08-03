import { describe, expect, it } from 'vitest';
import { parseCommuteRequest } from '../src/utils/parse-commute-request.js';

describe('parseCommuteRequest', () => {
  it('parses "X to Y"', () => {
    expect(parseCommuteRequest('Union to Unionville')).toEqual({
      from: 'Union',
      to: 'Unionville',
      startTime: null,
    });
  });

  it('parses a leading "from"', () => {
    expect(parseCommuteRequest('from Oakville to Union')).toEqual({
      from: 'Oakville',
      to: 'Union',
      startTime: null,
    });
  });

  it('parses arrow and dash separators', () => {
    expect(parseCommuteRequest('Aldershot -> Union')).toEqual({
      from: 'Aldershot',
      to: 'Union',
      startTime: null,
    });
    expect(parseCommuteRequest('Aldershot - Union')).toEqual({
      from: 'Aldershot',
      to: 'Union',
      startTime: null,
    });
  });

  it('extracts a 12h am/pm time', () => {
    expect(parseCommuteRequest('Union to Oakville at 5:30pm')).toEqual({
      from: 'Union',
      to: 'Oakville',
      startTime: '1730',
    });
  });

  it('extracts a 24h time', () => {
    expect(parseCommuteRequest('Union to Oakville 08:15')).toEqual({
      from: 'Union',
      to: 'Oakville',
      startTime: '0815',
    });
  });

  it('finds the route on a body line when the subject is noise', () => {
    const body = 'Hi there!\nUnion to Milton please\nThanks';
    expect(parseCommuteRequest(body, 'GO schedule')).toEqual({
      from: 'Union',
      to: 'Milton',
      startTime: null,
    });
  });

  it('returns null when no route is present', () => {
    expect(parseCommuteRequest('hello, how are you?', 'hi')).toBeNull();
  });
});

import type { Env } from '../config/env.js';
import type {
  JourneyResponse,
  JourneyService,
  JourneyTrip,
  MetrolinxStation,
  NormalizedJourney,
  ResolvedStop,
  SchJourney,
  StopAllResponse,
} from '../types/metrolinx.js';

const STOPS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REQUEST_TIMEOUT_MS = 10_000;

/** Coerce the Metrolinx "single item OR array" shape into an array. */
function toArray<T>(value: T[] | T | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bgo\b/g, ' ')
    .replace(/\bstation\b/g, ' ')
    .replace(/\bgo transit\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface StationMatch {
  stop: ResolvedStop;
  /** Other plausible stations, used to help the user when unsure. */
  alternatives: ResolvedStop[];
}

export type StationLookup =
  | { status: 'ok'; match: StationMatch }
  | { status: 'not_found'; suggestions: ResolvedStop[] };

export type JourneyLookup =
  | { status: 'ok'; from: ResolvedStop; to: ResolvedStop; date: string; journeys: NormalizedJourney[] }
  | { status: 'no_service'; from: ResolvedStop; to: ResolvedStop; date: string }
  | { status: 'station_not_found'; which: 'from' | 'to'; query: string; suggestions: ResolvedStop[] }
  | { status: 'error'; message: string };

export interface JourneyOptions {
  /** yyyymmdd. Defaults to today (America/Toronto). */
  date?: string;
  /** HHMM. Defaults to now (America/Toronto). */
  startTime?: string;
}

export interface MetrolinxService {
  isConfigured(): boolean;
  resolveStation(query: string): Promise<StationLookup>;
  planJourney(
    fromQuery: string,
    toQuery: string,
    options?: JourneyOptions,
  ): Promise<JourneyLookup>;
}

interface StopsCache {
  fetchedAt: number;
  stops: ResolvedStop[];
}

/** Format the current America/Toronto date as yyyymmdd. */
export function torontoDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/** Format the current America/Toronto time as HHMM (24h). */
export function torontoTime(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Intl can emit "24" for midnight in some environments; normalize to "00".
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${hour}${get('minute')}`;
}

function normalizeTripLegs(service: JourneyService) {
  return toArray<JourneyTrip>(service.Trips?.Trip).map((trip) => ({
    line: (trip.Display || trip.Line || 'GO Transit').trim(),
    direction: trip.Direction?.trim() || null,
    tripNumber: trip.Number?.trim() || null,
  }));
}

function normalizeService(service: JourneyService): NormalizedJourney {
  return {
    startTime: service.StartTime?.trim() ?? '',
    endTime: service.EndTime?.trim() ?? '',
    duration: service.Duration?.trim() || null,
    transferCount:
      typeof service.transferCount === 'number' ? service.transferCount : 0,
    accessible: /^(y|yes|true|1)$/i.test(service.Accessible?.trim() ?? ''),
    legs: normalizeTripLegs(service),
  };
}

export function createMetrolinxService(env: Env): MetrolinxService {
  const apiKey = env.METROLINX_API_KEY;
  const baseUrl = env.METROLINX_API_BASE_URL;
  let stopsCache: StopsCache | null = null;

  async function fetchJson<T>(path: string): Promise<T> {
    if (!apiKey) {
      throw new Error('Metrolinx API key is not configured');
    }
    const separator = path.includes('?') ? '&' : '?';
    const url = `${baseUrl}${path}${separator}key=${encodeURIComponent(apiKey)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Metrolinx API returned HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getStops(): Promise<ResolvedStop[]> {
    const now = Date.now();
    if (stopsCache && now - stopsCache.fetchedAt < STOPS_CACHE_TTL_MS) {
      return stopsCache.stops;
    }

    const data = await fetchJson<StopAllResponse>('/api/V1/Stop/All');
    const stations = toArray<MetrolinxStation>(data.Stations?.Station);
    const stops: ResolvedStop[] = stations
      .filter((s) => s.LocationCode && s.LocationName)
      .map((s) => ({ code: s.LocationCode.trim(), name: s.LocationName.trim() }));

    stopsCache = { fetchedAt: now, stops };
    return stops;
  }

  function matchStops(query: string, stops: ResolvedStop[]): StationLookup {
    const normalizedQuery = normalizeName(query);
    if (!normalizedQuery) {
      return { status: 'not_found', suggestions: [] };
    }

    // 1. Exact stop code (e.g. "UN").
    const upper = query.trim().toUpperCase();
    const byCode = stops.find((s) => s.code.toUpperCase() === upper);
    if (byCode) {
      return { status: 'ok', match: { stop: byCode, alternatives: [] } };
    }

    // 2. Exact normalized name.
    const exact = stops.filter((s) => normalizeName(s.name) === normalizedQuery);
    if (exact.length > 0) {
      return {
        status: 'ok',
        match: { stop: exact[0], alternatives: exact.slice(1, 4) },
      };
    }

    // 3. Substring / word-prefix matches, scored by closeness.
    const queryWords = normalizedQuery.split(' ').filter(Boolean);
    const scored = stops
      .map((stop) => {
        const name = normalizeName(stop.name);
        let score = 0;
        if (name.includes(normalizedQuery)) score += 100;
        if (name.startsWith(normalizedQuery)) score += 50;
        for (const word of queryWords) {
          if (name.split(' ').includes(word)) score += 10;
          else if (name.includes(word)) score += 3;
        }
        // Prefer shorter names on ties (closer to the query).
        score -= Math.min(name.length, 40) / 100;
        return { stop, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { status: 'not_found', suggestions: [] };
    }

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map((entry) => entry.stop);

    // If the best match is weak (no substring hit), treat as ambiguous.
    if (best.score < 10) {
      return {
        status: 'not_found',
        suggestions: scored.slice(0, 4).map((entry) => entry.stop),
      };
    }

    return { status: 'ok', match: { stop: best.stop, alternatives } };
  }

  return {
    isConfigured(): boolean {
      return Boolean(apiKey);
    },

    async resolveStation(query: string): Promise<StationLookup> {
      const stops = await getStops();
      return matchStops(query, stops);
    },

    async planJourney(
      fromQuery: string,
      toQuery: string,
      options: JourneyOptions = {},
    ): Promise<JourneyLookup> {
      try {
        const stops = await getStops();

        const fromLookup = matchStops(fromQuery, stops);
        if (fromLookup.status !== 'ok') {
          return {
            status: 'station_not_found',
            which: 'from',
            query: fromQuery,
            suggestions: fromLookup.suggestions,
          };
        }

        const toLookup = matchStops(toQuery, stops);
        if (toLookup.status !== 'ok') {
          return {
            status: 'station_not_found',
            which: 'to',
            query: toQuery,
            suggestions: toLookup.suggestions,
          };
        }

        const from = fromLookup.match.stop;
        const to = toLookup.match.stop;
        const date = options.date ?? torontoDate();
        const startTime = options.startTime ?? torontoTime();
        const maxJourney = env.METROLINX_MAX_JOURNEYS;

        const path =
          `/api/V1/Schedule/Journey/${date}/${encodeURIComponent(from.code)}/` +
          `${encodeURIComponent(to.code)}/${startTime}/${maxJourney}`;

        const data = await fetchJson<JourneyResponse>(path);

        const errorCode = data.Metadata?.ErrorCode;
        if (errorCode && errorCode !== '200' && errorCode !== '0') {
          const message = data.Metadata?.ErrorMessage?.trim();
          // Metrolinx uses error codes for "no trips found" too; treat those
          // as no service rather than a hard failure.
          if (message && /no\s+(trip|journey|service)/i.test(message)) {
            return { status: 'no_service', from, to, date };
          }
        }

        const journeys = toArray<SchJourney>(data.SchJourneys)
          .flatMap((journey) => toArray<JourneyService>(journey.Services))
          .map(normalizeService)
          .filter((journey) => journey.startTime || journey.endTime);

        if (journeys.length === 0) {
          return { status: 'no_service', from, to, date };
        }

        return { status: 'ok', from, to, date, journeys };
      } catch (error) {
        return {
          status: 'error',
          message: error instanceof Error ? error.message : 'unknown error',
        };
      }
    },
  };
}

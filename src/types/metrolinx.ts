/**
 * Minimal typings for the Metrolinx Open Data (GO Transit) API responses we use.
 * See https://api.openmetrolinx.com/OpenDataAPI/Help
 *
 * Only the fields this service reads are typed; unknown fields are ignored.
 */

export interface MetrolinxMetadata {
  TimeStamp?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

export interface MetrolinxStation {
  LocationCode: string;
  PublicStopId?: string;
  LocationName: string;
  LocationType?: string;
}

export interface StopAllResponse {
  Metadata?: MetrolinxMetadata;
  Stations?: {
    Station?: MetrolinxStation[] | MetrolinxStation;
  };
}

export interface JourneyTrip {
  Number?: string;
  Display?: string;
  Line?: string;
  Direction?: string;
  Type?: string;
}

export interface JourneyService {
  Colour?: string;
  Type?: string;
  Direction?: string;
  Code?: string;
  StartTime?: string;
  EndTime?: string;
  Duration?: string;
  Accessible?: string;
  Trips?: {
    Trip?: JourneyTrip[] | JourneyTrip;
  };
  transferCount?: number;
}

export interface SchJourney {
  Date?: string;
  Time?: string;
  To?: string;
  From?: string;
  Services?: JourneyService[] | JourneyService;
}

export interface JourneyResponse {
  Metadata?: MetrolinxMetadata;
  SchJourneys?: SchJourney[] | SchJourney;
}

/** A single leg of a planned journey, normalized for display. */
export interface JourneyLeg {
  line: string;
  direction: string | null;
  tripNumber: string | null;
}

/** A normalized, display-ready journey option. */
export interface NormalizedJourney {
  startTime: string;
  endTime: string;
  duration: string | null;
  transferCount: number;
  accessible: boolean;
  legs: JourneyLeg[];
}

/** Result of resolving a free-text station name to a Metrolinx stop. */
export interface ResolvedStop {
  code: string;
  name: string;
}

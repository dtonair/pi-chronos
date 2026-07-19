// ─── DST fixture timezones ────────────────────────────────────

/**
 * IANA timezone identifiers used in DST tests.
 *
 * America/New_York (US Eastern):
 *   2026: spring forward Sun Mar 8 02:00 → 03:00 EST→EDT
 *          fall back Sun Nov 1 02:00 → 01:00 EDT→EST
 *
 * Europe/London (UK):
 *   2026: spring forward Sun Mar 29 01:00 → 02:00 GMT→BST
 *          fall back Sun Oct 25 02:00 → 01:00 BST→GMT
 */
export const DST_ZONES = {
  /** US Eastern: spring forward, fall back */
  AMERICA_NEW_YORK: "America/New_York",
  /** UK: spring forward, fall back */
  EUROPE_LONDON: "Europe/London",
  /** Pacific: no DST */
  AMERICA_LOS_ANGELES: "America/Los_Angeles",
  /** Australia Eastern: DST in opposite hemisphere */
  AUSTRALIA_SYDNEY: "Australia/Sydney",
} as const;

/** UTC timestamps for DST transition tests. */

// America/New_York spring forward 2026: Mar 8 2026 02:00 EST → 03:00 EDT
// The gap is 02:00-02:59:59 local time which does not exist.
// UTC times:
// 2026-03-08T06:59:59Z → 01:59:59 EST
// 2026-03-08T07:00:00Z → 03:00:00 EDT (clocks jump forward, 02:00-02:59 skipped)

export const SPRING_FORWARD_NYC = {
  /** Just before the gap: 01:59:59 EST */
  beforeGap: Date.UTC(2026, 2, 8, 6, 59, 59, 0),
  /** First valid time in EDT: 03:00:00 EDT */
  afterGap: Date.UTC(2026, 2, 8, 7, 0, 0, 0),
  /** 02:30 local does not exist */
  inGap: "2026-03-08T02:30:00",
} as const;

// America/New_York fall back 2026: Nov 1 2026 02:00 EDT → 01:00 EST
// The repeated hour is 01:00-01:59:59 local time which occurs twice.
// First occurrence (EDT):
// 2026-11-01T05:00:00Z → 01:00:00 EDT (first 01:00)
// Second occurrence (EST):
// 2026-11-01T06:00:00Z → 01:00:00 EST (second 01:00)

export const FALL_BACK_NYC = {
  /** Midnight before the fall back: 00:00 EDT */
  midnight: Date.UTC(2026, 10, 1, 4, 0, 0, 0),
  /** First 01:00 (EDT) */
  firstOccurrence: Date.UTC(2026, 10, 1, 5, 0, 0, 0),
  /** Second 01:00 (EST): one hour later */
  secondOccurrence: Date.UTC(2026, 10, 1, 6, 0, 0, 0),
  /** 01:30 local wall time - occurs twice */
  repeatedWallTime: "01:30",
} as const;

// Europe/London fall back 2026: Oct 25 2026 02:00 BST → 01:00 GMT
export const FALL_BACK_LONDON = {
  /** Midnight before fall back (BST) */
  midnight: Date.UTC(2026, 9, 24, 23, 0, 0, 0),
  /** First 01:00 (BST) */
  firstOccurrence: Date.UTC(2026, 9, 25, 0, 0, 0, 0),
  /** Second 01:00 (GMT) */
  secondOccurrence: Date.UTC(2026, 9, 25, 1, 0, 0, 0),
} as const;

/**
 * Return the UTC epoch ms for a given UTC ISO timestamp.
 */
export function utcMs(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Return the ISO string for UTC epoch ms.
 */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

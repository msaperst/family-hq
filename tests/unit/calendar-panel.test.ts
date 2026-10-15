import { describe, expect, it } from 'vitest';
import { eventDay, eventTime, occursOn, type FamilyEvent } from '../../src/client/CalendarPanel';

describe('family calendar Phoenix date handling', () => {
  const event = (start: string, end: string, allDay = false): FamilyEvent =>
    ({ id: 'event', title: 'Event', start, end, allDay, location: null });
  it('converts UTC events to Phoenix dates and clock times', () => {
    const evening = event('2026-10-16T01:00:00Z', '2026-10-16T02:00:00Z');
    expect(eventDay(evening)).toBe('2026-10-15');
    expect(eventTime(evening)).toBe('6:00 PM');
    expect(occursOn(evening, '2026-10-15')).toBe(true);
    expect(occursOn(evening, '2026-10-16')).toBe(false);
  });
  it('returns the calendar day for all-day events', () => {
    expect(eventDay(event('2026-10-15', '2026-10-16', true))).toBe('2026-10-15');
  });
  it('excludes timed events ending at midnight and starting on the following day', () => {
    expect(occursOn(event('2026-10-15T22:00:00Z', '2026-10-16T07:00:00Z'), '2026-10-16')).toBe(false);
    expect(occursOn(event('2026-10-17T07:00:00Z', '2026-10-17T08:00:00Z'), '2026-10-16')).toBe(false);
  });
  it('handles exclusive end dates for multi-day all-day events', () => {
    const camping = event('2026-10-16', '2026-10-19', true);
    expect(eventTime(camping)).toBe('All day');
    expect(occursOn(camping, '2026-10-16')).toBe(true);
    expect(occursOn(camping, '2026-10-18')).toBe(true);
    expect(occursOn(camping, '2026-10-19')).toBe(false);
  });
  it('includes overnight timed events on both days but excludes boundary-only overlaps', () => {
    const overnight = event('2026-10-16T06:30:00Z', '2026-10-16T08:00:00Z');
    expect(occursOn(overnight, '2026-10-15')).toBe(true);
    expect(occursOn(overnight, '2026-10-16')).toBe(true);
    expect(occursOn(event('2026-10-16T07:00:00Z', '2026-10-16T08:00:00Z'), '2026-10-15')).toBe(false);
  });
});

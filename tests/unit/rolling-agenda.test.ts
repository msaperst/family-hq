import { describe, expect, it } from 'vitest';
import { activeAgenda, isInProgress, type FamilyEvent } from '../../src/client/CalendarPanel';

const event = (id: string, start: string, end: string, allDay = false): FamilyEvent =>
  ({ id, title: id, start, end, allDay, location: null });
describe('rolling family agenda', () => {
  const now = new Date('2026-10-15T23:00:00Z'); // 4 PM Phoenix
  it('hides finished events and keeps upcoming events', () => {
    const events = [
      event('finished', '2026-10-15T14:00:00Z', '2026-10-15T15:00:00Z'),
      event('upcoming', '2026-10-16T01:00:00Z', '2026-10-16T02:00:00Z'),
      event('ongoing', '2026-10-15T22:00:00Z', '2026-10-16T00:00:00Z'),
    ];
    expect(activeAgenda(events, now).map(item => item.id)).toEqual(['ongoing', 'upcoming']);
    expect(isInProgress(events[2], now)).toBe(true);
    expect(isInProgress(events[1], now)).toBe(false);
  });
  it('retains active all-day events through the local day and respects exclusive ends', () => {
    const events = [
      event('camp', '2026-10-15', '2026-10-17', true),
      event('ended', '2026-10-14', '2026-10-15', true),
    ];
    expect(activeAgenda(events, now).map(item => item.id)).toEqual(['camp']);
  });
  it('removes events exactly when they end', () => {
    expect(activeAgenda([event('ended', '2026-10-15T22:00:00Z', '2026-10-15T23:00:00Z')], now)).toEqual([]);
  });
});

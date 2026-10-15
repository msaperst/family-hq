// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalendarPanel, type FamilyEvent } from '../../src/client/CalendarPanel';

const TODAY = '2026-10-15';
const calendarUrl = (from: string, to: string) => `/api/calendar/events?from=${from}&to=${to}`;
const initialUrl = calendarUrl(TODAY, '2026-10-22');
const fetchMock = vi.fn<typeof fetch>();
const event = (id: string, start = '2026-10-16T01:00:00Z', end = '2026-10-16T02:00:00Z', location: string | null = null): FamilyEvent =>
  ({ id, title: id, start, end, allDay: false, location });
const reply = (events: FamilyEvent[] = [], stale = false): Response =>
  ({ ok: true, json: async () => ({ events, stale }) }) as Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T23:00:00Z'));
  fetchMock.mockResolvedValue(reply());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('CalendarPanel UI and data lifecycle', () => {
  it('loads the first seven days, renders timed events and locations, and hides completed events', async () => {
    fetchMock.mockResolvedValue(reply([
      event('Already finished', '2026-10-15T14:00:00Z', '2026-10-15T15:00:00Z'),
      event('Currently happening', '2026-10-15T22:00:00Z', '2026-10-16T00:00:00Z', 'Library'),
      event('Tomorrow appointment', '2026-10-16T17:00:00Z', '2026-10-16T18:00:00Z'),
    ]));
    render(<CalendarPanel today={TODAY} />);
    expect(screen.getByText('Loading calendar…')).toBeTruthy();
    expect(await screen.findByText('Currently happening')).toBeTruthy();
    expect(screen.getByText('Tomorrow appointment')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Library')).toBeTruthy();
    expect(screen.queryByText('Already finished')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(initialUrl, { signal: expect.any(AbortSignal) });
  });

  it('shows saved events and a stale warning', async () => {
    fetchMock.mockResolvedValue(reply([event('Cached appointment')], true));
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findByText('Cached appointment')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Showing saved events');
  });

  it.each([
    ['network error', () => Promise.reject(new Error('offline'))],
    ['HTTP failure', () => Promise.resolve({ ok: false } as Response)],
    ['invalid JSON shape', () => Promise.resolve({ ok: true, json: async () => ({ columns: [] }) } as Response)],
  ])('shows an unavailable state for %s', async (_label, implementation) => {
    fetchMock.mockImplementation(implementation);
    render(<CalendarPanel today={TODAY} />);
    expect((await screen.findByRole('status')).textContent).toContain('Calendar unavailable');
    expect(screen.queryByText('Loading calendar…')).toBeNull();
  });

  it('loads the next seven days and appends rather than replaces existing events', async () => {
    fetchMock.mockImplementation(async url => String(url) === initialUrl
      ? reply([event('First week')])
      : reply([event('Second week', '2026-10-24T01:00:00Z', '2026-10-24T02:00:00Z')]));
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findByText('First week')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
    expect(await screen.findByText('Second week')).toBeTruthy();
    expect(screen.getByText('First week')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(calendarUrl('2026-10-22', '2026-10-29'));
  });

  it('deduplicates events across fetched windows', async () => {
    fetchMock.mockResolvedValue(reply([event('Multi-day shared event')]));
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findByText('Multi-day shared event')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('Multi-day shared event')).toHaveLength(1);
  });

  it('retries failed pagination without losing previously loaded events', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async url => {
      if (String(url) === initialUrl) return reply([event('Original event')]);
      attempts++;
      if (attempts === 1) throw new Error('offline');
      return reply([event('Recovered event', '2026-10-24T01:00:00Z', '2026-10-24T02:00:00Z')]);
    });
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findByText('Original event')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
    const retry = await screen.findByRole('button', { name: 'Retry loading events' });
    expect(screen.getByText('Original event')).toBeTruthy();
    fireEvent.click(retry);
    expect(await screen.findByText('Recovered event')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry loading events' })).toBeNull();
  });

  it('loads more on scrolling near the bottom, not when far away', async () => {
    render(<CalendarPanel today={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = document.querySelector('.calendar-body') as HTMLDivElement;
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    fireEvent.scroll(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    body.scrollTop = 500;
    fireEvent.scroll(body);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('does not issue overlapping pagination requests', async () => {
    let resolveNext!: (response: Response) => void;
    fetchMock.mockImplementation(async url => String(url) === initialUrl ? reply() : new Promise<Response>(resolve => { resolveNext = resolve; }));
    render(<CalendarPanel today={TODAY} />);
    await screen.findByRole('button', { name: 'Load more events' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
    await screen.findByText('Loading more events…');
    const body = document.querySelector('.calendar-body') as HTMLDivElement;
    fireEvent.scroll(body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => resolveNext(reply()));
  });

  it('refreshes on visibility and preserves loaded events', async () => {
    fetchMock.mockResolvedValueOnce(reply([event('Original')])).mockResolvedValue(reply([event('Updated')]));
    render(<CalendarPanel today={TODAY} />);
    await screen.findByText('Original');
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('Updated')).toBeTruthy();
    expect(screen.getByText('Original')).toBeTruthy();
  });

  it('restarts the initial range when today changes and aborts the old request', async () => {
    render(<CalendarPanel today={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    // The initial effect's abort signal is released on unmount.
    cleanup();
    expect(oldSignal.aborted).toBe(true);
  });
});

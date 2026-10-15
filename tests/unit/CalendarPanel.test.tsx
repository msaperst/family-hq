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
  it('shows all-day multi-day events and excludes expired all-day events', async () => {
    fetchMock.mockResolvedValue(reply([
      { id: 'camp', title: 'Camping', start: '2026-10-15', end: '2026-10-17', allDay: true, location: null },
      { id: 'old', title: 'Yesterday only', start: '2026-10-14', end: '2026-10-15', allDay: true, location: null },
    ]));
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findAllByText('Camping')).toHaveLength(2);
    expect(screen.getAllByText('All day')).toHaveLength(2);
    expect(screen.queryByText('Yesterday only')).toBeNull();
  });

  it('marks a paginated stale response as saved data', async () => {
    fetchMock.mockImplementation(async url => String(url) === initialUrl ? reply() : reply([], true));
    render(<CalendarPanel today={TODAY} />);
    const button = await screen.findByRole('button', { name: 'Load more events' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Showing saved events')).toBeTruthy());
  });

  it.each([
    ['HTTP error', { ok: false } as Response],
    ['invalid response', { ok: true, json: async () => ({ invalid: true }) } as Response],
  ])('offers retry after paginated %s', async (_description, failedResponse) => {
    fetchMock.mockImplementation(async url => String(url) === initialUrl ? reply() : failedResponse);
    render(<CalendarPanel today={TODAY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more events' }));
    expect(await screen.findByRole('button', { name: 'Retry loading events' })).toBeTruthy();
  });

  it('updates the agenda when an event ends without another network request', async () => {
    fetchMock.mockResolvedValue(reply([event('Ending soon', '2026-10-15T22:00:00Z', '2026-10-15T23:01:00Z')]));
    render(<CalendarPanel today={TODAY} />);
    expect(await screen.findByText('Ending soon')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(screen.queryByText('Ending soon')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while the document is hidden', async () => {
    const previous = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try {
      render(<CalendarPanel today={TODAY} />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      fireEvent(document, new Event('visibilitychange'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previous) Object.defineProperty(document, 'hidden', previous);
      else Reflect.deleteProperty(document, 'hidden');
    }
  });

  it('resets the date range and aborts the previous request when the day changes', async () => {
    const { rerender } = render(<CalendarPanel today={TODAY} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    rerender(<CalendarPanel today="2026-10-16" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(calendarUrl('2026-10-16', '2026-10-23'), { signal: expect.any(AbortSignal) }));
    expect(signal.aborted).toBe(true);
  });

  it('reaches the 90-day limit with a final four-day request and stops loading', async () => {
    fetchMock.mockResolvedValue(reply());
    render(<CalendarPanel today={TODAY} />);
    for (let i = 0; i < 12; i++) {
      fireEvent.click(await screen.findByRole('button', { name: 'Load more events' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(i + 2));
    }
    expect(await screen.findByText('End of 90-day calendar window')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more events' })).toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(calendarUrl('2027-01-07', '2027-01-13'));
  });

});

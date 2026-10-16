// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
vi.mock('../../src/client/CalendarPanel', () => ({ CalendarPanel: () => null }));
import { App } from '../../src/client/App';
import type { DashboardResponse } from '../../src/shared/dashboard';

const fetchMock = vi.fn<typeof fetch>();
const fixture: DashboardResponse = {
  today: '2026-10-14', through: '2026-10-20',
  columns: [
    { id: 'porter', name: 'Porter', chores: [
      { id: 'overdue', name: 'Laundry', startsOn: '2026-10-13', dueOn: '2026-10-13', mode: 'individual', childId: 'porter', completed: false },
      { id: 'bed', name: 'Make bed', startsOn: '2026-10-14', dueOn: '2026-10-14', mode: 'individual', childId: 'porter', completed: false },
      { id: 'tomorrow', name: 'Read', startsOn: '2026-10-15', dueOn: '2026-10-15', mode: 'individual', childId: 'porter', completed: false },
      { id: 'friday', name: 'Dishes', startsOn: '2026-10-16', dueOn: '2026-10-16', mode: 'individual', childId: 'porter', completed: false },
      { id: 'weekly', name: 'Clean room', startsOn: '2026-10-12', dueOn: '2026-10-18', mode: 'individual', childId: 'porter', completed: false },
    ] },
    { id: 'either', name: 'Either child', chores: [
      { id: 'pets', name: 'Feed pets', startsOn: '2026-10-14', dueOn: '2026-10-14', mode: 'either', childId: null, completed: false },
    ] },
  ],
};
function response(data: DashboardResponse = fixture): Response {
  return { ok: true, json: async () => data } as Response;
}
beforeEach(() => {
  fetchMock.mockImplementation(async (_url, options) => {
    if (options && 'method' in options && options.method === 'PUT') return { ok: true, json: async () => ({ changed: true, completed: true }) } as Response;
    return response();
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('Family HQ dashboard', () => {
  it('shows a loading state while waiting for data', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading chores…')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/chores\?date=\d{4}-\d{2}-\d{2}&more=false$/), { signal: expect.any(AbortSignal) });
  });
  it('renders dynamic columns, overdue chores, tomorrow and flexible weekly chores', async () => {
    render(<App />);
    const porter = await screen.findByRole('region', { name: 'Porter' });
    expect(within(porter).getByText('Yesterday · Overdue')).toBeTruthy();
    expect(within(porter).getByText('Tomorrow')).toBeTruthy();
    expect(within(porter).getByText('Clean room')).toBeTruthy();
    expect(within(porter).getByText('Dishes')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Either child' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Miller' })).toBeNull();
  });
  it('shows upcoming chores without requiring an expansion button', async () => {
    render(<App />);
    expect(await screen.findByText('Dishes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show more upcoming chores/ })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/chores\?date=\d{4}-\d{2}-\d{2}&more=false$/), { signal: expect.any(AbortSignal) });
  });
  it('sends completion updates for individual chores', async () => {
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make bed/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/chores/bed/completion', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ childId: 'porter', completed: true }),
    })));
  });
  it('uses a shared completion target for either-child chores', async () => {
    render(<App />);
    await screen.findByText('Feed pets');
    fireEvent.click(screen.getByRole('checkbox', { name: /Feed pets/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/chores/pets/completion', expect.objectContaining({
      body: JSON.stringify({ childId: null, completed: true }),
    })));
  });
  it('shows an empty state without columns', async () => {
    fetchMock.mockResolvedValue(response({ ...fixture, columns: [] }));
    render(<App />);
    expect(await screen.findByText(/No chores scheduled/)).toBeTruthy();
  });
  it('reports a failed dashboard request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to load chores|Showing saved chores|Chores unavailable/);
  });
  it('reports non-OK dashboard responses', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to load chores|Showing saved chores|Chores unavailable/);
  });
  it('reports a failed completion without claiming success', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') return { ok: false } as Response;
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make bed/ }));
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toMatch(/Could not save completion|Network lost/);
    expect(screen.getByRole('checkbox', { name: /Make bed/ })).toHaveProperty('checked', false);
  });
  it('reports completion network errors and restores the control', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') throw new Error('Network lost');
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make bed/ }));
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toMatch(/Could not save completion|Network lost/);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Make bed/ })).toHaveProperty('disabled', false));
  });
  it('disables a chore while its completion request is pending', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') {
        return await new Promise<Response>(resolve => { finish = resolve; });
      }
      return response();
    });
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Make bed/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveProperty('disabled', true));
    expect(fetchMock.mock.calls.filter(call => call[1] && 'method' in call[1] && call[1].method === 'PUT')).toHaveLength(1);
    finish({ ok: true } as Response);
    await waitFor(() => expect(checkbox).toHaveProperty('disabled', false));
  });
  it('clears an earlier connection error after a successful refresh', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('Temporary outage');
      return response();
    });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to load chores|Showing saved chores|Chores unavailable/);
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('Make bed')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('refreshes when the page becomes visible', async () => {
    render(<App />);
    await screen.findByText('Make bed');
    const before = fetchMock.mock.calls.length;
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
  it('shows later chores directly without a hint or toggle', async () => {
    fetchMock.mockResolvedValue(response({ ...fixture, columns: [{
        id: 'porter', name: 'Porter', chores: [{
          id: 'future', name: 'Faraway task', startsOn: '2026-10-19', dueOn: '2026-10-19',
          mode: 'individual', childId: 'porter', completed: false,
        }],
      }] }));
    render(<App />);
    expect(await screen.findByText('Faraway task')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /upcoming chores/i })).toBeNull();
  });
  it('refreshes automatically on the 30-second polling interval', async () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not refresh on a visibility event while the page is hidden', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try {
      render(<App />);
      await screen.findByText('Make bed');
      const before = fetchMock.mock.calls.length;
      fireEvent(document, new Event('visibilitychange'));
      expect(fetchMock).toHaveBeenCalledTimes(before);
    } finally {
      if (original) Object.defineProperty(document, 'hidden', original);
      else Reflect.deleteProperty(document, 'hidden');
    }
  });
  it('ignores a rejected request after its signal is aborted', async () => {
    let rejectRequest!: (error: unknown) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; }));
    const { unmount } = render(<App />);
    unmount();
    rejectRequest(new Error('Cancelled'));
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('uses a fallback error message for non-Error request failures', async () => {
    fetchMock.mockRejectedValue('offline');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('Unable to load chores');
  });
  it('uses a fallback message for non-Error completion failures', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') throw 'failed';
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make bed/ }));
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toMatch(/Could not save completion|Network lost/);
  });
  it('keeps already loaded chores visible during a subsequent refresh error', async () => {
    let reads = 0;
    fetchMock.mockImplementation(async () => {
      reads++;
      if (reads > 1) throw new Error('Refresh failed');
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent(document, new Event('visibilitychange'));
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toMatch(/Unable to load chores|Showing saved chores|Chores unavailable/);
    expect(screen.getByText('Make bed')).toBeTruthy();
  });
  it('aborts the outstanding request on unmount', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<App />);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('overdue completion undo window', () => {
  it('keeps an overdue completion checked even when the server omits it, and supports undo', async () => {
    let completed = false;
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') {
        completed = JSON.parse(options.body as string).completed as boolean;
        return { ok: true } as Response;
      }
      return response({ ...fixture, columns: fixture.columns.map(column => ({ ...column,
        chores: column.chores.filter(chore => chore.id !== 'overdue' || !completed),
      })) });
    });
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Laundry/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveProperty('checked', true));
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Laundry/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', false));
    expect(completed).toBe(false);
  });
  it('expires the locally retained overdue completion after 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      let completed = false;
      fetchMock.mockImplementation(async (_url, options) => {
        if (options && 'method' in options && options.method === 'PUT') {
          completed = true;
          return { ok: true } as Response;
        }
        return response({ ...fixture, columns: fixture.columns.map(column => ({ ...column,
          chores: column.chores.filter(chore => chore.id !== 'overdue' || !completed),
        })) });
      });
      render(<App />);
      await vi.waitFor(() => expect(screen.getByRole('checkbox', { name: /Laundry/ })).toBeTruthy());
      fireEvent.click(screen.getByRole('checkbox', { name: /Laundry/ }));
      await vi.waitFor(() => expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', true));
      await vi.advanceTimersByTimeAsync(31_000);
      expect(screen.queryByRole('checkbox', { name: /Laundry/ })).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe('overdue undo branch coverage', () => {
  it('retains a completed shared overdue chore in the Either child column', async () => {
    const sharedOverdue = {
      id: 'shared-overdue', name: 'Shared overdue task', startsOn: '2026-10-13',
      dueOn: '2026-10-13', mode: 'either' as const, childId: null, completed: false,
    };
    let completed = false;
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') {
        completed = JSON.parse(options.body as string).completed as boolean;
        return { ok: true } as Response;
      }
      return response({ ...fixture, columns: [{
        id: 'either', name: 'Either child',
        chores: completed ? [] : [sharedOverdue],
      }] });
    });
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Shared overdue task/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Shared overdue task/ })).toHaveProperty('checked', true));
    expect(within(screen.getByRole('region', { name: 'Either child' })).getByText('Shared overdue task')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/chores/shared-overdue/completion', expect.objectContaining({
      body: JSON.stringify({ childId: null, completed: true }),
    }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Shared overdue task/ }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Shared overdue task/ })).toHaveProperty('checked', false));
    expect(completed).toBe(false);
  });

  it('keeps the local completed state when a refresh still returns an unchecked overdue chore', async () => {
    // Simulate a stale read during eventual synchronization.
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') return { ok: true } as Response;
      return response();
    });
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Laundry/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', true));
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/chores?date=') && url.endsWith('&more=false')).length).toBeGreaterThanOrEqual(3));
    expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Laundry/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/chores/overdue/completion', expect.objectContaining({
      body: JSON.stringify({ childId: 'porter', completed: false }),
    })));
  });

  it('does not start an undo window when saving an overdue completion fails', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') return { ok: false } as Response;
      return response();
    });
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Laundry/ });
    fireEvent.click(checkbox);
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toMatch(/Could not save completion|Network lost/);
    expect(screen.getByRole('checkbox', { name: /Laundry/ })).toHaveProperty('checked', false);
  });
});

describe('weekly chore pagination and service recovery', () => {
  const later = (id: string, name: string, day: string): DashboardResponse => ({
    today: day, through: day, columns: [{
      id: 'porter', name: 'Porter', chores: [{
        id, name, startsOn: day, dueOn: day, mode: 'individual', childId: 'porter', completed: false,
      }],
    }],
  });
  it('uses a generic panel when the first request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<App />);
    const panel = await screen.findByRole('region', { name: 'Chores' });
    expect(within(panel).getByRole('alert').textContent).toBe('Unable to load chores');
    expect(screen.queryByRole('region', { name: 'Porter' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Miller' })).toBeNull();
  });
  it('appends the next week without dropping or duplicating existing chores', async () => {
    fetchMock.mockImplementation(async (url) => response(String(url).includes('window=true')
      ? { ...later('second', 'Second week chore', '2026-10-22'), columns: [{
        ...later('second', 'Second week chore', '2026-10-22').columns[0],
        chores: [...later('second', 'Second week chore', '2026-10-22').columns[0].chores, fixture.columns[0].chores[1]],
      }] }
      : fixture));
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    await screen.findByText('Second week chore');
    expect(screen.getAllByText('Make bed')).toHaveLength(1);
    expect(screen.getAllByText('Second week chore')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('window=true'))).toBe(true);
  });
  it('retries a failed page without advancing the week', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('window=true')) {
        attempts++;
        if (attempts === 1) return { ok: false } as Response;
        return response(later('recovered', 'Recovered next week', '2026-10-22'));
      }
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    const retry = await screen.findAllByRole('button', { name: 'Retry loading chores' });
    fireEvent.click(retry[0]);
    await screen.findByText('Recovered next week');
    const pageCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'));
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls[0][0]).toBe(pageCalls[1][0]);
  });
  it('keeps saved chores visible and clears the warning after recovery', async () => {
    let reads = 0;
    fetchMock.mockImplementation(async () => {
      if (++reads === 2) throw new Error('offline');
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent(document, new Event('visibilitychange'));
    expect((await within(screen.getByRole('region', { name: 'Porter' })).findByRole('alert')).textContent).toContain('Showing saved chores');
    expect(screen.getByText('Make bed')).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Porter' })).queryByRole('alert')).toBeNull());
  });
});

describe('chore pagination edge cases', () => {
  const nextPage = (id: string, name: string): DashboardResponse => ({
    today: '2026-10-21', through: '2026-10-27',
    columns: [{ id: 'porter', name: 'Porter', chores: [{
      id, name, startsOn: '2026-10-22', dueOn: '2026-10-22',
      mode: 'individual', childId: 'porter', completed: false,
    }] }],
  });
  it('loads the next week when a chore column is scrolled near the bottom', async () => {
    fetchMock.mockImplementation(async url => response(String(url).includes('window=true') ? nextPage('new', 'Scroll loaded') : fixture));
    render(<App />);
    const column = await screen.findByRole('region', { name: 'Porter' });
    const body = column.querySelector('.column-body') as HTMLDivElement;
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    fireEvent.scroll(body);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'))).toHaveLength(0);
    Object.defineProperty(body, 'scrollTop', { configurable: true, value: 600 });
    fireEvent.scroll(body);
    expect(await screen.findByText('Scroll loaded')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'))).toHaveLength(1);
  });
  it('does not send duplicate page requests while the first is pending', async () => {
    let finish!: (result: Response) => void;
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('window=true')) return new Promise<Response>(resolve => { finish = resolve; });
      return response();
    });
    render(<App />);
    const porter = await screen.findByRole('region', { name: 'Porter' });
    fireEvent.click(within(porter).getByRole('button', { name: 'Load more chores' }));
    const body = porter.querySelector('.column-body') as HTMLDivElement;
    fireEvent.scroll(body);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'))).toHaveLength(1);
    finish(response(nextPage('one', 'Pending finished')));
    expect(await screen.findByText('Pending finished')).toBeTruthy();
  });
  it('adds a new child column from a later week and preserves it during refresh', async () => {
    const second = { ...nextPage('miller-task', 'Miller later'), columns: [{
      id: 'miller', name: 'Miller', chores: [{ ...nextPage('miller-task', 'Miller later').columns[0].chores[0], childId: 'miller' }],
    }] };
    fetchMock.mockImplementation(async url => response(String(url).includes('window=true') ? second : fixture));
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    expect(await screen.findByText('Miller later')).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByText('Miller later')).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Porter' })).toBeTruthy();
  });
  it('retains loaded future chores after refreshing the initial week', async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('window=true')) return response(nextPage('future', 'Future retained'));
      return response(refreshed ? { ...fixture, columns: fixture.columns.map(column => ({
        ...column, chores: column.chores.filter(chore => chore.id !== 'bed'),
      })) } : fixture);
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    await screen.findByText('Future retained');
    refreshed = true;
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('more=false')).length).toBeGreaterThan(1));
    expect(screen.getByText('Future retained')).toBeTruthy();
  });
  it('allows completing a chore loaded from a later week', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'PUT') return { ok: true } as Response;
      return response(String(url).includes('window=true') ? nextPage('later-task', 'Later task') : fixture);
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    const later = await screen.findByRole('checkbox', { name: /Later task/ });
    fireEvent.click(later);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/chores/later-task/completion', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ childId: 'porter', completed: true }),
    })));
  });
  it('stops offering further pages after thirteen weeks', async () => {
    fetchMock.mockImplementation(async url => response(String(url).includes('window=true')
      ? { ...nextPage('none', 'Unused'), columns: [] }
      : fixture));
    render(<App />);
    await screen.findByText('Make bed');
    for (let week = 1; week < 13; week++) {
      const button = screen.getAllByRole('button', { name: 'Load more chores' })[0];
      fireEvent.click(button);
      await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'))).toHaveLength(week));
      if (week < 12) await waitFor(() => expect(screen.getAllByRole('button', { name: 'Load more chores' }).length).toBeGreaterThan(0));
    }
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more chores' })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('window=true'))).toHaveLength(12);
  });
});

describe('additional dashboard recovery paths', () => {
  it('uses a generic message for non-Error initial failures', async () => {
    fetchMock.mockRejectedValue('offline');
    render(<App />);
    const panel = await screen.findByRole('region', { name: 'Chores' });
    expect(within(panel).getByRole('alert').textContent).toBe('Unable to load chores');
  });

  it('retries a network-rejected future week and retains existing chores', async () => {
    let pages = 0;
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('window=true')) {
        pages++;
        if (pages === 1) throw new Error('Disconnected');
        return response({ today: '2026-10-21', through: '2026-10-27', columns: [] });
      }
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    const retry = await screen.findAllByRole('button', { name: 'Retry loading chores' });
    expect(screen.getByText('Make bed')).toBeTruthy();
    fireEvent.click(retry[0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry loading chores' })).toBeNull());
    expect(pages).toBe(2);
    expect(screen.getByText('Make bed')).toBeTruthy();
  });

  it('refreshes existing chore details after another week has loaded', async () => {
    let latest = false;
    fetchMock.mockImplementation(async url => {
      if (String(url).includes('window=true')) return response({ today: '2026-10-21', through: '2026-10-27', columns: [] });
      if (!latest) return response();
      return response({ ...fixture, columns: fixture.columns.map(column => ({
        ...column, chores: column.chores.map(chore => chore.id === 'bed' ? { ...chore, name: 'Make bed updated' } : chore),
      })) });
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getAllByRole('button', { name: 'Load more chores' })[0]);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('window=true'))).toBe(true));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Load more chores' }).length).toBeGreaterThan(0));
    latest = true;
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('Make bed updated')).toBeTruthy();
    expect(screen.queryByText('Make bed')).toBeNull();
  });
});

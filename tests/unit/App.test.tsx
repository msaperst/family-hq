// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(fetchMock).toHaveBeenCalledWith('/api/chores?more=false', { signal: expect.any(AbortSignal) });
  });
  it('renders dynamic columns, overdue chores, tomorrow and flexible weekly chores', async () => {
    render(<App />);
    const porter = await screen.findByRole('region', { name: 'Porter' });
    expect(within(porter).getByText('Yesterday · Overdue')).toBeTruthy();
    expect(within(porter).getByText('Tomorrow')).toBeTruthy();
    expect(within(porter).getByText('Clean room')).toBeTruthy();
    expect(within(porter).queryByText('Dishes')).toBeNull();
    expect(screen.getByRole('region', { name: 'Either child' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Miller' })).toBeNull();
  });
  it('expands additional upcoming chores on request', async () => {
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('button', { name: 'Show more upcoming chores' }));
    expect(await screen.findByText('Dishes')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/chores?more=true', { signal: expect.any(AbortSignal) });
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
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'offline');
  });
  it('reports non-OK dashboard responses', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to load chores');
  });
  it('reports a failed completion without claiming success', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options && 'method' in options && options.method === 'PUT') return { ok: false } as Response;
      return response();
    });
    render(<App />);
    await screen.findByText('Make bed');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make bed/ }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save completion');
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
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Network lost');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Make bed/ })).toHaveProperty('disabled', false));
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

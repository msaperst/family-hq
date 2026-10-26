// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../../src/client/CalendarPanel', () => ({ CalendarPanel: () => null }));
import { App } from '../../src/client/App';
import type { DashboardResponse, DashboardChore } from '../../src/shared/dashboard';

const day = '2026-10-26';
const item = (id: string, dueOn = day, mode: DashboardChore['mode'] = 'individual', skipped = false): DashboardChore =>
  ({ id, name: id, startsOn: dueOn, dueOn, mode, childId: mode === 'either' ? null : 'alex', completed: false, skipped });

let dataset: DashboardResponse;
let fail = false;
const mockFetch = vi.fn();
beforeEach(() => {
  fail = false;
  dataset = { today: day, through: '2026-11-01', columns: [
    { id: 'alex', name: 'Alex', chores: [item('Today task'), item('Old task', '2026-10-25')] },
    { id: 'either', name: 'Either child', chores: [item('Shared task', day, 'either')] },
  ] };
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return { ok: true, json: async () => ({ revision: 'development' }) };
    if (url.startsWith('/api/chores/') && init?.method === 'PUT') {
      if (fail) return { ok: false };
      const id = decodeURIComponent(url.split('/')[3]!);
      const body = JSON.parse(String(init.body)) as { skipped: boolean };
      for (const column of dataset.columns) {
        column.chores = column.chores.map(chore => chore.id === id ? { ...chore, skipped: body.skipped } : chore);
      }
      return { ok: true, json: async () => ({ changed: true }) };
    }
    return { ok: true, json: async () => structuredClone(dataset) };
  });
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function skip(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Actions for ' + name }));
  const row = screen.getByText(name).closest('.swipe-chore');
  if (!row) throw new Error('Chore row not found');
  fireEvent.click(row.querySelector('.swipe-action')!);
}

describe('dashboard skip handler', () => {
  it('saves a daily skip, preserves its row and supports undo', async () => {
    render(<App />);
    await screen.findByText('Today task');
    skip('Today task');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/chores/Today%20task/skip',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ childId: 'alex', skipped: true }) })));
    await waitFor(() => expect(screen.getByText('Skipped · Today')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Undo skip' }));
    await waitFor(() => expect(screen.queryByText('Skipped · Today')).toBeNull());
    expect(mockFetch).toHaveBeenCalledWith('/api/chores/Today%20task/skip',
      expect.objectContaining({ body: JSON.stringify({ childId: 'alex', skipped: false }) }));
  });
  it('retains overdue skipped row for undo after server omits it', async () => {
    render(<App />);
    await screen.findByText('Old task');
    skip('Old task');
    await waitFor(() => expect(screen.getByText('Skipped · Yesterday · Overdue')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Undo skip' }));
    await waitFor(() => expect(screen.queryByText('Skipped · Yesterday · Overdue')).toBeNull());
  });
  it('reports skipped mutation errors and leaves the chore unchanged', async () => {
    fail = true;
    render(<App />);
    await screen.findByText('Today task');
    skip('Today task');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch('Could not save skip'));
    expect(screen.queryByText('Skipped · Today')).toBeNull();
  });
  it('uses a null child for either-child skip', async () => {
    render(<App />);
    await screen.findByText('Shared task');
    skip('Shared task');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/chores/Shared%20task/skip',
      expect.objectContaining({ body: JSON.stringify({ childId: null, skipped: true }) })));
  });
});

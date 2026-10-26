// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HistoryDashboard } from '../../src/client/HistoryDashboard';
import type { HistoryResponse } from '../../src/shared/history';

const fixture: HistoryResponse = {
  from: '2026-10-20', through: '2026-10-26', today: '2026-10-26',
  entries: [
    { id: 'one', name: 'Dishes', dueOn: '2026-10-26', childId: 'a', childName: 'Alex', status: 'completed' },
    { id: 'two', name: 'Laundry', dueOn: '2026-10-26', childId: 'a', childName: 'Alex', status: 'skipped' },
    { id: 'three', name: 'Pets', dueOn: '2026-10-25', childId: 'b', childName: 'Blair', status: 'outstanding' },
  ],
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockResolvedValue({ ok: true, json: async () => fixture } as Response); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('chore history dashboard', () => {
  it('shows correct totals and individual daily outcomes', async () => {
    render(<HistoryDashboard />);
    const summary = await screen.findByRole('region', { name: 'Chore summary' });
    expect(within(summary).getByText('33%')).toBeTruthy();
    expect(within(summary).getByText('1 of 3 scheduled')).toBeTruthy();
    expect(screen.getByText('Dishes')).toBeTruthy();
    expect(screen.getByText('Laundry')).toBeTruthy();
    expect(screen.getByText('Pets')).toBeTruthy();
  });
  it('filters to one child and updates all summary counts', async () => {
    render(<HistoryDashboard />);
    await screen.findByText('Dishes');
    fireEvent.change(screen.getByRole('combobox', { name: 'Child' }), { target: { value: 'a' } });
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1 of 2 scheduled')).toBeTruthy();
    expect(screen.queryByText('Pets')).toBeNull();
  });
  it('switches from seven to thirty days through the API', async () => {
    render(<HistoryDashboard />);
    await screen.findByText('Dishes');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/history?days=30', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('renders a meaningful empty state without a divide-by-zero rate', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...fixture, entries: [] }) } as Response);
    render(<HistoryDashboard />);
    await screen.findByText('0 of 0 scheduled');
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getAllByText('No chores due this day.')).toHaveLength(7);
  });
  it('shows loading and failure states', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const view = render(<HistoryDashboard />);
    expect(screen.getByRole('status').textContent).toContain('Loading history');
    view.unmount();
    fetchMock.mockResolvedValue({ ok: false } as Response);
    render(<HistoryDashboard />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to load chore history. Try refreshing.');
  });
});

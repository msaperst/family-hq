// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const fetchMock = vi.fn<typeof fetch>();
const schedule = {
  id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly',
  intervalCount: 1, weekdays: [], anchorDate: '2026-10-12', endDate: null,
  rotation: 'none', paused: false, assignees: ['porter'],
};
const children = [{ id: 'porter', name: 'Porter' }, { id: 'miller', name: 'Miller' }];
const occurrence = { key: 'weekly:2026-10-19', startsOn: '2026-10-19', dueOn: '2026-10-25',
  assignees: ['porter'], skipped: false };
const ok = (value: unknown): Response => ({ ok: true, json: async () => value } as Response);
beforeEach(() => {
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method) return ok({ updated: true });
    const path = String(url);
    if (path.endsWith('/preview')) return ok({ occurrences: [occurrence] });
    if (path.endsWith('/exceptions')) return ok({ exceptions: [] });
    if (path.endsWith('/children')) return ok({ children });
    return ok({ schedules: [schedule] });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe('parent settings', () => {
  it('loads schedules and shows their flexible weekly deadline', async () => {
    render(<ParentSettings />);
    expect(await screen.findByText('Clean bedroom')).toBeTruthy();
    expect(screen.getByText(/Weekly · due Sunday/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });
  it('opens existing schedules with saved assignments and flexible deadline', async () => {
    render(<ParentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByDisplayValue('Clean bedroom')).toBeTruthy();
    expect(screen.getByLabelText('Anytime during the week, due Sunday')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Porter')).toHaveProperty('checked', true);
    expect(await screen.findByText(/2026-10-19 – 2026-10-25/)).toBeTruthy();
  });
  it('changes weekly deadline to a selected weekday and saves edits', async () => {
    render(<ParentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText('On selected day(s)'));
    expect(screen.getByLabelText('Sun')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parent/schedules/weekly',
      expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"weekdays":[6]') })));
  });
  it('pauses and resumes through the API', async () => {
    render(<ParentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parent/schedules/weekly',
      expect.objectContaining({ method: 'PATCH', body: '{"paused":true}' })));
  });
  it('creates a rotating chore for two children', async () => {
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Feed pets' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.change(screen.getByLabelText('Rotate assignment'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByLabelText('Miller'));
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parent/schedules',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"rotation":"daily"') })));
  });
  it('saves a one-day skip exception', async () => {
    render(<ParentSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exception' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parent/schedules/weekly/exceptions/2026-10-19',
      expect.objectContaining({ method: 'PUT', body: '{"action":"skip"}' })));
  });
  it('displays a request failure without clearing the form', async () => {
    fetchMock.mockImplementation(async url => String(url).endsWith('/children') ? { ok: false } as Response : ok({ schedules: [schedule] }));
    render(<ParentSettings />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to load parent settings');
  });
});

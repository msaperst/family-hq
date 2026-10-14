// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const schedules = [
  { id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly', intervalCount: 1,
    weekdays: [], anchorDate: '2026-10-12', endDate: null, rotation: 'none', paused: false, assignees: ['porter'] },
  { id: 'shared', name: 'Feed pets', mode: 'either', frequency: 'daily', intervalCount: 1,
    weekdays: [], anchorDate: '2026-10-12', endDate: null, rotation: 'none', paused: true, assignees: ['porter', 'miller'] },
];
const children = [{ id: 'porter', name: 'Porter' }, { id: 'miller', name: 'Miller' }];
const exceptions = [{ originalDate: '2026-12-07', action: 'move', newDate: '2026-12-08', childId: null },
  { originalDate: '2026-12-14', action: 'reassign', newDate: null, childId: 'miller' }];
const mock = vi.fn<typeof fetch>();
const response = (data: unknown, ok = true): Response => ({ ok, json: async () => data } as Response);
beforeEach(() => {
  mock.mockImplementation(async (url, options) => {
    if (options?.method) return response({});
    const path = String(url);
    if (path.endsWith('/preview')) return response({ occurrences: [
      { key: 'weekly:2026-12-07', startsOn: '2026-12-07', dueOn: '2026-12-13', assignees: ['porter'], skipped: false },
      { key: 'weekly:2026-12-14', startsOn: '2026-12-14', dueOn: '2026-12-20', assignees: ['miller'], skipped: true },
    ] });
    if (path.endsWith('/exceptions')) return response({ exceptions });
    if (path.endsWith('/children')) return response({ children });
    return response({ schedules });
  });
  vi.stubGlobal('fetch', mock);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function edit() {
  render(<ParentSettings />);
  await screen.findByText('Clean bedroom');
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  await screen.findByText(/2026-12-07 – 2026-12-13/);
}
describe('additional parent settings interactions', () => {
  it('shows paused schedules and cancels editing', async () => {
    await edit();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.getByText(/2026-12-14 – 2026-12-20/)).toHaveProperty('textContent', expect.stringContaining('Skipped'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(screen.queryByRole('heading', { name: 'Upcoming occurrences' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Add a chore' })).toBeTruthy();
  });
  it('switches assignment mode and supports multiple assignees', async () => {
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Who completes it?'), { target: { value: 'each' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.click(screen.getByLabelText('Miller'));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'interval_days' } });
    fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    // No name yet, so submission must remain disabled.
    expect(mock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Water plants' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"intervalCount":3'),
    })));
  });
  it('supports weekday toggles and switching to a weekly deadline', async () => {
    await edit();
    fireEvent.click(screen.getByLabelText('On selected day(s)'));
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Sun'));
    fireEvent.click(screen.getByLabelText('Anytime during the week, due Sunday'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules/weekly',
      expect.objectContaining({ body: expect.stringContaining('"weekdays":[]') })));
  });
  it('saves move and reassign exceptions with the correct payload', async () => {
    await edit();
    const action = screen.getByLabelText('Action');
    const original = screen.getByLabelText('Original scheduled date');
    fireEvent.change(original, { target: { value: '2026-12-07' } });
    fireEvent.change(action, { target: { value: 'move' } });
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2026-12-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules/weekly/exceptions/2026-12-07',
      expect.objectContaining({ method: 'PUT', body: '{"action":"move","newDate":"2026-12-08"}' })));
    fireEvent.change(action, { target: { value: 'reassign' } });
    fireEvent.change(screen.getByLabelText('Assign to'), { target: { value: 'miller' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules/weekly/exceptions/2026-12-07',
      expect.objectContaining({ method: 'PUT', body: '{"action":"reassign","childId":"miller"}' })));
  });
  it('removes an exception and refreshes the preview', async () => {
    await edit();
    const list = screen.getByRole('heading', { name: 'Existing exceptions' }).parentElement!;
    fireEvent.click(within(list).getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules/weekly/exceptions/2026-12-07',
      expect.objectContaining({ method: 'DELETE' })));
  });

  it('removes an assigned child when toggled off in multi-child mode', async () => {
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Who completes it?'), { target: { value: 'either' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.click(screen.getByLabelText('Miller'));
    fireEvent.click(screen.getByLabelText('Porter'));
    expect(screen.getByLabelText('Porter')).toHaveProperty('checked', false);
    expect(screen.getByLabelText('Miller')).toHaveProperty('checked', true);
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Feed fish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith('/api/parent/schedules',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"assignees":["miller"]') })));
  });
  it('sends changed start and end dates and preserves them when editing', async () => {
    await edit();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-12-28' } });
    expect(screen.getByLabelText('End date (optional)')).toHaveProperty('min', '2026-11-02');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const request = mock.mock.calls.find(call => String(call[0]).endsWith('/schedules/weekly') && call[1]?.method === 'PUT');
      expect(request).toBeDefined();
      expect(JSON.parse(request![1]!.body as string)).toMatchObject({
        anchorDate: '2026-11-02', endDate: '2026-12-28',
      });
    });
  });
  it('shows save, pause and exception API failures', async () => {
    mock.mockImplementation(async (url, options) => {
      if (options?.method) return response({ error: 'Rejected by API' }, false);
      const path = String(url);
      if (path.endsWith('/preview')) return response({ occurrences: [] });
      if (path.endsWith('/exceptions')) return response({ exceptions });
      if (path.endsWith('/children')) return response({ children });
      return response({ schedules });
    });
    await editWithEmptyPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not update schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Rejected by API');
    fireEvent.change(screen.getByLabelText('Original scheduled date'), { target: { value: '2026-12-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Rejected by API');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not remove exception');
  });
});
async function editWithEmptyPreview() {
  render(<ParentSettings />);
  await screen.findByText('Clean bedroom');
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  await screen.findByText('No upcoming occurrences in the next four weeks.');
}

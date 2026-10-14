// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const children = [{ id: 'porter', name: 'Porter' }, { id: 'miller', name: 'Miller' }];
const weekly = { id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly',
  intervalCount: 1, weekdays: [0, 6], anchorDate: '2026-10-12', endDate: null,
  rotation: 'weekly', paused: false, assignees: ['porter', 'miller'] };
const mock = vi.fn<typeof fetch>();
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body } as Response);
let schedules: typeof weekly[];
let overrides: { originalDate: string; action: string; newDate: string | null; childId: string | null }[];
beforeEach(() => {
  schedules = [{ ...weekly }];
  overrides = [{ originalDate: '2099-01-05', action: 'skip', newDate: null, childId: null }];
  mock.mockImplementation(async (url, init) => {
    const path = String(url);
    if (init?.method) return ok({});
    if (path.endsWith('/preview')) return ok({ occurrences: [
      { key: 'weekly:2099-01-05', startsOn: '2099-01-05', dueOn: '2099-01-05', assignees: ['porter'], skipped: false },
    ] });
    if (path.endsWith('/exceptions')) return ok({ exceptions: overrides });
    if (path.endsWith('/children')) return ok({ children });
    return ok({ schedules });
  });
  vi.stubGlobal('fetch', mock);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function openEditor() {
  render(<ParentSettings />);
  await screen.findByText('Clean bedroom');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('Existing exceptions');
}
describe('parent settings conditional behavior', () => {
  it('shows selected weekly weekdays and narrows rotating assignees when rotation is disabled', async () => {
    await openEditor();
    expect(screen.getByText(/Weekly · Mon, Sun/)).toBeTruthy();
    expect(screen.getByLabelText('Mon')).toHaveProperty('checked', true);
    fireEvent.change(screen.getByLabelText('Rotate assignment'), { target: { value: 'none' } });
    expect(screen.getByLabelText('Porter')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Miller')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const request = mock.mock.calls.find(([url, init]) => String(url).endsWith('/schedules/weekly') && init?.method === 'PUT');
      expect(JSON.parse(request![1]!.body as string)).toMatchObject({ rotation: 'none', assignees: ['porter'], weekdays: [0, 6] });
    });
  });
  it('disables saving a selected-day weekly schedule with no selected weekdays', async () => {
    await openEditor();
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Sun'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('Fri'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false);
  });
  it('shows a preview loading failure without losing the edit form', async () => {
    mock.mockImplementation(async (url, init) => {
      if (init?.method) return ok({});
      if (String(url).endsWith('/preview')) return ok({}, 503);
      if (String(url).endsWith('/exceptions')) return ok({ exceptions: [] });
      if (String(url).endsWith('/children')) return ok({ children });
      return ok({ schedules });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load schedule preview');
    expect(screen.getByDisplayValue('Clean bedroom')).toBeTruthy();
  });
  it('disables removing past exceptions and allows removing future ones', async () => {
    overrides = [
      { originalDate: '2020-01-01', action: 'skip', newDate: null, childId: null },
      { originalDate: '2099-01-05', action: 'skip', newDate: null, childId: null },
    ];
    await openEditor();
    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    expect(buttons[0]).toHaveProperty('disabled', true);
    expect(buttons[1]).toHaveProperty('disabled', false);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(mock).toHaveBeenCalledWith(
      '/api/parent/schedules/weekly/exceptions/2099-01-05', expect.objectContaining({ method: 'DELETE' })));
  });

  it('shows schedule assignee fallback and exception assignee fallback when a child is missing', async () => {
    schedules = [{ ...weekly, assignees: ['retired'] }];
    overrides = [{ originalDate: '2099-01-05', action: 'reassign', newDate: null, childId: 'retired' }];
    await openEditor();
    expect(screen.getByText(/retired · Active/)).toBeTruthy();
    expect(screen.getByText(/2099-01-05: reassign → retired/)).toBeTruthy();
  });
  it('switches from daily to weekly, then to an interval and back to a flexible week', async () => {
    schedules = [{ ...weekly, frequency: 'daily', weekdays: [] }];
    await openEditor();
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    expect(screen.getByLabelText('Anytime during the week, due Sunday')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByLabelText('On selected day(s)'));
    expect(screen.getByLabelText('Sun')).toHaveProperty('checked', true);
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'interval_weeks' } });
    fireEvent.change(screen.getByLabelText('Repeat interval'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const request = mock.mock.calls.find(([url, init]) => String(url).endsWith('/schedules/weekly') && init?.method === 'PUT');
      expect(JSON.parse(request![1]!.body as string)).toMatchObject({ frequency: 'interval_weeks', intervalCount: 2 });
    });
  });
  it('renders an exception preview when its start and due dates match', async () => {
    await openEditor();
    expect(screen.getByText(/2099-01-05 · Porter/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exception' }));
    expect(screen.getByLabelText('Original scheduled date')).toHaveProperty('value', '2099-01-05');
  });
  it('handles preview exceptions endpoint failures', async () => {
    mock.mockImplementation(async (url, init) => {
      if (init?.method) return ok({});
      if (String(url).endsWith('/preview')) return ok({ occurrences: [] });
      if (String(url).endsWith('/exceptions')) return ok({}, 503);
      if (String(url).endsWith('/children')) return ok({ children });
      return ok({ schedules });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load schedule preview');
  });
  it('clears assignees and rotation when switching away from individual mode', async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText('Who completes it?'), { target: { value: 'either' } });
    expect(screen.queryByLabelText('Rotate assignment')).toBeNull();
    expect(screen.getByLabelText('Porter')).toHaveProperty('checked', false);
    expect(screen.getByLabelText('Miller')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByLabelText('Miller'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const request = mock.mock.calls.find(([url, init]) => String(url).endsWith('/schedules/weekly') && init?.method === 'PUT');
      expect(JSON.parse(request![1]!.body as string)).toMatchObject({ mode: 'either', rotation: 'none', assignees: ['miller'] });
    });
  });
  it('reports a failed create request and preserves entered values', async () => {
    mock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return ok({}, 500);
      if (String(url).endsWith('/children')) return ok({ children });
      return ok({ schedules });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Wash dishes' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not create chore');
    expect(screen.getByDisplayValue('Wash dishes')).toBeTruthy();
  });
});

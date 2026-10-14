// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const schedule = { id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly',
  intervalCount: 1, weekdays: [], anchorDate: '2026-10-12', endDate: null,
  rotation: 'none', paused: false, assignees: ['porter'] };
const children = [{ id: 'porter', name: 'Porter' }, { id: 'miller', name: 'Miller' }];
const response = (data: unknown) => ({ ok: true, json: async () => data } as Response);
const mock = vi.fn<typeof fetch>();
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  mock.mockImplementation(async (url, options) => {
    if (options?.method) return response({});
    const path = String(url);
    if (path.endsWith('/children')) return response({ children });
    if (path.endsWith('/preview')) return response({ occurrences: [] });
    if (path.endsWith('/exceptions')) return response({ exceptions: [] });
    return response({ schedules: [schedule] });
  });
  vi.stubGlobal('fetch', mock);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function edit() {
  render(<ParentSettings />);
  await screen.findByText('Clean bedroom');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('No upcoming occurrences in the next four weeks.');
}
describe('concurrent parent operations', () => {
  it('submits a chore only once even if the form emits a second submit during a pending request', async () => {
    const pending = deferred();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') return pending.promise;
      if (String(url).endsWith('/children')) return response({ children });
      return response({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Laundry' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    const button = screen.getByRole('button', { name: 'Add chore' });
    const form = button.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(button).toHaveProperty('disabled', true));
    fireEvent.submit(form);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    pending.resolve(response({}));
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  it('submits an exception only once while its first save is pending', async () => {
    await edit();
    fireEvent.change(screen.getByLabelText('Original scheduled date'), { target: { value: '2099-01-05' } });
    const pending = deferred();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === 'PUT') return pending.promise;
      if (String(url).endsWith('/preview')) return response({ occurrences: [] });
      if (String(url).endsWith('/exceptions')) return response({ exceptions: [] });
      if (String(url).endsWith('/children')) return response({ children });
      return response({ schedules: [schedule] });
    });
    const button = screen.getByRole('button', { name: 'Save exception' });
    const form = button.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(button).toHaveProperty('disabled', true));
    fireEvent.submit(form);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
    pending.resolve(response({}));
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
  });
  it('keeps existing weekdays when switching from a daily schedule to fixed weekly dates', async () => {
    await edit();
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    expect(screen.getByLabelText('On selected day(s)')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Mon')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Sun')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = mock.mock.calls.find(([url, options]) => String(url).endsWith('/schedules/weekly') && options?.method === 'PUT');
      expect(JSON.parse(call![1]!.body as string)).toMatchObject({ weekdays: [0], frequency: 'weekly' });
    });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const schedule = { id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly',
  intervalCount: 1, weekdays: [], anchorDate: '2026-10-12', endDate: null,
  rotation: 'none', paused: false, assignees: ['alex'] };
const children = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }];
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
    fireEvent.click(screen.getByLabelText('Alex'));
    const button = screen.getByRole('button', { name: 'Add chore' });
    const form = button.closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(button).toHaveProperty('disabled', true));
    fireEvent.submit(form);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    pending.resolve(response({}));
    await waitFor(() => expect(screen.getByLabelText('Chore name')).toHaveProperty('value', ''));
    expect(screen.getByLabelText('Alex')).toHaveProperty('checked', false);
    expect(button).toHaveProperty('disabled', true);
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

  it('prevents a second pause action while the first PATCH is pending', async () => {
    const pending = deferred();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') return pending.promise;
      if (String(url).endsWith('/children')) return response({ children });
      return response({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    const pause = screen.getByRole('button', { name: 'Pause' });
    fireEvent.click(pause);
    await waitFor(() => expect(pause).toHaveProperty('disabled', true));
    fireEvent.click(pause);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
    pending.resolve(response({}));
    await waitFor(() => expect(pause).toHaveProperty('disabled', false));
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
  });
  it('prevents duplicate exception removal while the DELETE is pending', async () => {
    mock.mockImplementation(async (url, options) => {
      if (options?.method) return response({});
      const path = String(url);
      if (path.endsWith('/children')) return response({ children });
      if (path.endsWith('/preview')) return response({ occurrences: [] });
      if (path.endsWith('/exceptions')) return response({ exceptions: [
        { originalDate: '2099-01-05', action: 'skip', newDate: null, childId: null },
      ] });
      return response({ schedules: [schedule] });
    });
    await edit();
    const pending = deferred();
    const previous = mock.getMockImplementation()!;
    mock.mockImplementation((url, options) => options?.method === 'DELETE' ? pending.promise : previous(url, options));
    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    await waitFor(() => expect(remove).toHaveProperty('disabled', true));
    fireEvent.click(remove);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
    pending.resolve(response({}));
    await waitFor(() => expect(remove).toHaveProperty('disabled', false));
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
  });

  it('allows only one mutation when two different actions arrive in the same React batch', async () => {
    const pending = deferred();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') return pending.promise;
      if (String(url).endsWith('/children')) return response({ children });
      return response({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Laundry' } });
    fireEvent.click(screen.getByLabelText('Alex'));
    const form = screen.getByRole('button', { name: 'Add chore' }).closest('form')!;
    const pause = screen.getByRole('button', { name: 'Pause' });
    act(() => {
      fireEvent.click(pause);
      fireEvent.submit(form);
    });
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
    expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    pending.resolve(response({}));
    await waitFor(() => expect(pause).toHaveProperty('disabled', false));
    fireEvent.submit(form);
    await waitFor(() => expect(mock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1));
  });
  it('releases the mutation lock after a failed request', async () => {
    const pending = deferred();
    mock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') return pending.promise;
      if (String(url).endsWith('/children')) return response({ children });
      return response({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    const pause = screen.getByRole('button', { name: 'Pause' });
    fireEvent.click(pause);
    pending.resolve({ ok: false, json: async () => ({}) } as Response);
    await screen.findByRole('alert');
    await waitFor(() => expect(pause).toHaveProperty('disabled', false));
    fireEvent.click(pause);
    await waitFor(() => expect(mock.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(2));
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

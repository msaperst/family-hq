// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const schedule = { id: 'weekly', name: 'Clean bedroom', mode: 'individual', frequency: 'weekly',
  intervalCount: 1, weekdays: [], anchorDate: '2026-10-12', endDate: null,
  rotation: 'none', paused: false, assignees: ['porter'] };
const children = [{ id: 'porter', name: 'Porter' }, { id: 'miller', name: 'Miller' }];
const occurrence = { key: 'weekly:2099-01-05', startsOn: '2099-01-05', dueOn: '2099-01-05',
  assignees: ['unknown-child'], skipped: false };
const ok = (value: unknown, success = true) => ({ ok: success, json: async () => value } as Response);
const fetchMock = vi.fn<typeof fetch>();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method) return ok({});
    const path = String(url);
    if (path.endsWith('/preview')) return ok({ occurrences: [occurrence] });
    if (path.endsWith('/exceptions')) return ok({ exceptions: [
      { originalDate: '2099-01-05', action: 'skip', newDate: null, childId: null },
    ] });
    if (path.endsWith('/children')) return ok({ children });
    return ok({ schedules: [schedule] });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
async function edit() {
  render(<ParentSettings />);
  await screen.findByText('Clean bedroom');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('Existing exceptions');
}
describe('LCOV uncovered parent settings branches', () => {
  it('handles a non-Error rejection while initially loading settings (line 45)', async () => {
    fetchMock.mockRejectedValueOnce('offline');
    render(<ParentSettings />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to load settings');
  });
  it('handles a non-Error rejection when loading an edited schedule (line 58)', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/preview')) throw 'preview offline';
      if (String(url).endsWith('/exceptions')) return ok({ exceptions: [] });
      if (String(url).endsWith('/children')) return ok({ children });
      if (init?.method) return ok({});
      return ok({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load preview');
  });
  it('handles non-Error create failures (line 85)', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') throw 'network lost';
      if (String(url).endsWith('/children')) return ok({ children });
      return ok({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Wash dishes' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not create chore');
  });
  it('handles non-Error exception save failures (line 102)', async () => {
    await edit();
    fetchMock.mockImplementationOnce(async () => { throw 'network lost'; });
    fireEvent.change(screen.getByLabelText('Original scheduled date'), { target: { value: '2099-01-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save exception');
  });
  it('handles non-Error exception deletion failures (line 113)', async () => {
    await edit();
    fetchMock.mockImplementationOnce(async () => { throw 'network lost'; });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not remove exception');
  });
  it('handles non-Error pause failures (line 126)', async () => {
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fetchMock.mockImplementationOnce(async () => { throw 'network lost'; });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not update schedule');
  });
  it('falls back when exception save response has no error message (line 100)', async () => {
    await edit();
    fetchMock.mockImplementationOnce(async () => ok({}, false));
    fireEvent.change(screen.getByLabelText('Original scheduled date'), { target: { value: '2099-01-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save exception');
  });
  it('renders an unknown assignee in an unskipped occurrence (line 203)', async () => {
    await edit();
    expect(screen.getByText(/2099-01-05 · unknown-child/)).toBeTruthy();
  });
  it('keeps controls disabled while a create request is pending (lines 74 and 90)', async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return pending.promise;
      if (String(url).endsWith('/children')) return ok({ children });
      return ok({ schedules: [schedule] });
    });
    render(<ParentSettings />);
    await screen.findByText('Clean bedroom');
    fireEvent.change(screen.getByLabelText('Chore name'), { target: { value: 'Wash dishes' } });
    fireEvent.click(screen.getByLabelText('Porter'));
    fireEvent.click(screen.getByRole('button', { name: 'Add chore' }));
    expect(screen.getByRole('button', { name: 'Add chore' })).toHaveProperty('disabled', true);
    pending.resolve(ok({}));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add chore' })).toHaveProperty('disabled', true));
  });
  it('preserves existing selected weekdays when choosing selected-day weekly mode (line 182)', async () => {
    await edit();
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByLabelText('On selected day(s)'));
    expect(screen.getByLabelText('Mon')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Sun')).toHaveProperty('checked', false);
  });
});

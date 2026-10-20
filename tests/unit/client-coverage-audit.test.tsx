// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App';
import type { DashboardResponse } from '../../src/shared/dashboard';

const data: DashboardResponse = {
  today: '2026-10-14', through: '2026-10-20',
  columns: [{ id: 'alex', name: 'Alex', chores: [{
    id: 'bed', name: 'Make bed', startsOn: '2026-10-14', dueOn: '2026-10-14',
    mode: 'individual', childId: 'alex', completed: false,
  }] }],
};
const ok = (): Response => ({ ok: true, json: async () => data }) as Response;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('dashboard cancellation and pending completion', () => {
  it('ignores a successful response after the component unmounts', async () => {
    let resolveRequest!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { resolveRequest = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<App />);
    unmount();
    resolveRequest(ok());
    await Promise.resolve();
    expect(screen.queryByRole('region', { name: 'Alex' })).toBeNull();
  });
  it('blocks repeated completion while a save is pending', async () => {
    let resolveSave!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(async (_url, options) => {
      if (options?.method === 'PUT') return await new Promise<Response>(resolve => { resolveSave = resolve; });
      return ok();
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const checkbox = await screen.findByRole('checkbox', { name: /Make bed/ });
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toHaveProperty('disabled', true));
    fireEvent.click(checkbox);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
    resolveSave({ ok: true } as Response);
    await waitFor(() => expect(checkbox).toHaveProperty('disabled', false));
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/client/App';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function response(status: string, ok = true): Response {
  return { ok, json: async () => ({ status, service: 'family-hq' }) } as Response;
}

describe('Family HQ connection status', () => {
  it('shows the pending state while the request is unresolved', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Family HQ' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Checking connection');
    expect(fetchMock).toHaveBeenCalledWith('/api/health', { signal: expect.any(AbortSignal) });
  });

  it('shows Connected for a healthy API', async () => {
    fetchMock.mockResolvedValue(response('ok'));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Connected'));
  });

  it('shows unavailable for a non-ok health payload', async () => {
    fetchMock.mockResolvedValue(response('degraded'));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API unavailable'));
  });

  it('shows unavailable for an HTTP error', async () => {
    fetchMock.mockResolvedValue(response('error', false));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API unavailable'));
  });

  it('shows unavailable for a rejected request', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API unavailable'));
  });

  it('shows unavailable for malformed JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } } as Response);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('API unavailable'));
  });

  it('aborts the outstanding request when unmounted', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<App />);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('ignores an AbortError rather than reporting an API failure', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toContain('Checking connection');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ParentSettings } from '../../src/client/ParentSettings';

const fetchMock = vi.fn<typeof fetch>();
const ok = (data: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => data,
}) as Response;
let children: { id: string; name: string; active: number }[];
beforeEach(() => {
  children = [];
  fetchMock.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === '/api/parent/children' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as { name: string };
      if (children.some(child => child.name.toLowerCase() === body.name.trim().toLowerCase()))
        return ok({ error: 'A child with this name already exists' }, 409);
      const child = { id: 'new-child', name: body.name.trim(), active: 1 };
      children = [...children, child];
      return ok(child, 201);
    }
    if (path.startsWith('/api/parent/children/') && options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body)) as { name?: string; active?: boolean };
      children = children.map(child => child.id === path.split('/').at(-1)
        ? { ...child, ...(body.name ? { name: body.name } : {}), ...(body.active === undefined ? {} : { active: Number(body.active) }) }
        : child);
      return ok(children[0]);
    }
    if (path === '/api/parent/children') return ok({ children });
    if (path === '/api/children') return ok({ children: children.filter(child => child.active).map(({ id, name }) => ({ id, name })) });
    return ok({ schedules: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  it('cancels renaming without saving or changing the original name', async () => {
    children = [{ id: 'original', name: 'Alex', active: 1 }];
    render(<ParentSettings />);
    await screen.findAllByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename child'), { target: { value: 'Taylor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Child name')).toHaveProperty('value', '');
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(0);
  });

  it('retains a child and shows an error when a status update fails', async () => {
    children = [{ id: 'original', name: 'Alex', active: 1 }];
    const previous = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url) === '/api/parent/children/original' && options?.method === 'PATCH')
        return ok({ error: 'Pause or reassign active schedules before deactivating this child' }, 409);
      return previous(url, options);
    });
    render(<ParentSettings />);
    await screen.findAllByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent', 'Pause or reassign active schedules before deactivating this child',
    );
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeTruthy();
  });

  it('does not delete a child when confirmation is declined', async () => {
    children = [{ id: 'original', name: 'Alex', active: 1 }];
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<ParentSettings />);
    await screen.findAllByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'DELETE')).toHaveLength(0);
  });

});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('parent settings child controls', () => {
  it('starts with no children, then creates, renames, deactivates and reactivates a child', async () => {
    render(<ParentSettings />);
    expect(await screen.findByText('No children yet. Add a child to get started.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add chore' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Child name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    expect((await screen.findAllByText('Alex')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename child'), { target: { value: 'Taylor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save child name' }));
    expect((await screen.findAllByText('Taylor')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reactivate' })).toBeTruthy());
    expect(screen.queryByLabelText('Taylor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deactivate' })).toBeTruthy());
    expect(screen.getByLabelText('Taylor')).toBeTruthy();
  });

  it('keeps a child form open and shows the server error for duplicate names', async () => {
    children = [{ id: 'original', name: 'Alex', active: 1 }];
    render(<ParentSettings />);
    await screen.findAllByText('Alex');
    fireEvent.change(screen.getByLabelText('Child name'), { target: { value: 'alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'A child with this name already exists');
    expect(screen.getByLabelText('Child name')).toHaveProperty('value', 'alex');
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../../src/client/CalendarPanel', () => ({ CalendarPanel: () => null }));
import { SwipeChore } from '../../src/client/App';
import type { DashboardChore } from '../../src/shared/dashboard';

const chore: DashboardChore = {
  id: 'chore', name: 'Take out trash', startsOn: '2026-10-26', dueOn: '2026-10-26',
  mode: 'individual', childId: 'alex', completed: false, skipped: false,
};
const today = '2026-10-26';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(item: DashboardChore = chore, busy = false) {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const view = render(<SwipeChore chore={item} today={today} busy={busy} onComplete={onComplete} onSkip={onSkip} />);
  const face = view.container.querySelector('.swipe-face')!;
  return { view, face, onComplete, onSkip };
}

describe('swipe chore interactions', () => {
  it('reveals only after a deliberate left swipe, without changing completion', () => {
    const { view, face, onSkip, onComplete } = setup();
    fireEvent.pointerDown(face, { clientX: 180, clientY: 20 });
    fireEvent.pointerUp(face, { clientX: 80, clientY: 23 });
    expect(view.container.querySelector('.swipe-chore')!.className).toContain('revealed');
    expect(onComplete).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledWith(chore);
  });
  it('ignores vertical/short gestures, permits closing by swipe right and menu', () => {
    const { view, face } = setup();
    fireEvent.pointerDown(face, { clientX: 150, clientY: 10 });
    fireEvent.pointerUp(face, { clientX: 133, clientY: 90 });
    expect(view.container.querySelector('.revealed')).toBeNull();
    const menu = screen.getByRole('button', { name: 'Actions for Take out trash' });
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(face, { clientX: 30, clientY: 20 });
    fireEvent.pointerUp(face, { clientX: 130, clientY: 20 });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });
  it('shows a single undo action for skipped chores and disables completion', () => {
    const skipped = { ...chore, skipped: true };
    const { onSkip } = setup(skipped);
    expect(screen.getAllByRole('button', { name: 'Undo skip' })).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo skip' }));
    expect(onSkip).toHaveBeenCalledWith(skipped);
  });
  it('blocks actions while pending and never skips a completed chore', () => {
    const { onSkip, view } = setup(chore, true);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).not.toHaveBeenCalled();
    view.unmount();
    setup({ ...chore, completed: true });
    expect(screen.getByRole('button', { name: 'Skip' })).toHaveProperty('disabled', true);
  });
  it('ignores pointer starts on interactive controls', () => {
    const { view, face } = setup();
    fireEvent.pointerDown(screen.getByRole('checkbox'), { clientX: 150, clientY: 20 });
    fireEvent.pointerUp(face, { clientX: 40, clientY: 20 });
    expect(view.container.querySelector('.revealed')).toBeNull();
  });
});

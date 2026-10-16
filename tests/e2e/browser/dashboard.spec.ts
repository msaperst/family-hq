import { expect } from '@playwright/test';
import { test } from './fixture.js';

test('renders an empty household as an aligned chore panel with exact copy', async ({ page }) => {
  await page.route('**/api/chores?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ today: '2026-10-16', through: '2026-10-22', columns: [] }),
    });
  });
  await page.goto('/');
  const chores = page.getByRole('region', { name: 'Chores' });
  const calendar = page.getByRole('heading', { name: 'Coming up' });
  await expect(chores).toBeVisible();
  await expect(calendar).toBeVisible();
  const message = chores.locator('.chore-empty-state');
  await expect(message).toHaveText("No chores scheduled. Everyone's caught up!");
  await expect(chores.getByRole('heading', { name: 'Chores' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more chores' })).toHaveCount(0);
  // Empty states should not render as an orphan paragraph above the panel.
  await expect(page.locator('.dashboard > .empty')).toHaveCount(0);
  const left = await chores.boundingBox();
  const right = await page.locator('.dashboard-content .calendar-panel').boundingBox();
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  expect(Math.abs(left!.y - right!.y)).toBeLessThan(5);
});

for (const count of [1, 2, 3]) {
  test(`keeps ${count} child chore columns aligned beside calendar in landscape`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.route('**/api/chores?**', async route => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          today: '2026-10-16', through: '2026-10-22',
          columns: Array.from({ length: count }, (_, index) => ({
            id: `child-${index}`, name: `Child ${index + 1}`, chores: [],
          })),
        }),
      });
    });
    await page.goto('/');
    const columns = page.locator('.chores-panel .column');
    await expect(columns).toHaveCount(count);
    const calendar = await page.locator('.dashboard-content .calendar-panel').boundingBox();
    expect(calendar).not.toBeNull();
    const bounds = await columns.evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, width: rect.width };
      }),
    );
    for (const rect of bounds) {
      expect(rect.top).toBeCloseTo(bounds[0]!.top, 0);
      expect(rect.right).toBeLessThan(calendar!.x);
    }
    const widths = bounds.map(rect => rect.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  });
}

test('shows first-run setup only for an empty child roster', async ({ page }) => {
  await page.route('**/api/children', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ children: [] }),
  }));
  await page.route('**/api/chores?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ today: '2026-10-16', through: '2026-10-22', columns: [] }),
  }));
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Chores' });
  await expect(panel.getByRole('link', { name: 'Set up your household' })).toHaveAttribute('href', '/settings');
  await page.unroute('**/api/children');
  await page.route('**/api/children', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ children: [{ id: 'alex', name: 'Alex' }] }),
  }));
  await page.reload();
  await expect(panel.getByText("No chores scheduled. Everyone's caught up!")).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Set up your household' })).toHaveCount(0);
});

test('shows active child columns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Miller' })).toBeVisible();
});
test('shows a single shared column', async ({ page }) => {
  await page.goto('/');
  const shared = page.getByRole('region', { name: 'Either child' });
  await expect(page.getByRole('region', { name: 'Either child' })).toHaveCount(1);
  await expect(shared.locator('label.chore').filter({ hasText: 'Feed pets' }).filter({ hasText: 'Today' })).toHaveCount(1);
});
test('shows overdue chores with their original due date', async ({ page }) => {
  await page.goto('/');
  const porter = page.getByRole('region', { name: 'Porter' });
  await expect(porter.getByText('Put laundry away')).toBeVisible();
  await expect(porter.locator('label.chore').filter({ hasText: 'Put laundry away' }).getByText('Yesterday · Overdue')).toBeVisible();
});
test('shows flexible weekly chores before the deadline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Clean bedroom').first()).toBeVisible();
});
test('retains a completed overdue chore for undo, but hides it after reload', async ({ page }) => {
  await page.goto('/');
  const laundry = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Put laundry away' });
  await laundry.getByRole('checkbox').click();
  await expect(laundry.getByRole('checkbox')).toBeChecked();
  await page.reload();
  await expect(laundry).toHaveCount(0);
});
test('persists completion across reload', async ({ page }) => {
  await page.goto('/');
  const bed = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox');
  await bed.click();
  await expect(bed).toBeChecked();
  await page.reload();
  await expect(bed).toBeChecked();
});
test('supports undoing a completed chore', async ({ page }) => {
  await page.goto('/');
  const bed = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox');
  await bed.click();
  await expect(bed).toBeChecked();
  await bed.click();
  await expect(bed).not.toBeChecked();
});
test('shows all seven days of chores without an expansion control', async ({ page }) => {
  await page.goto('/');
  const porter = page.getByRole('region', { name: 'Porter' });
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' })).toHaveCount(7);
  await expect(page.getByRole('button', { name: /Show more upcoming chores|Hide upcoming chores/ })).toHaveCount(0);
});
test('shared completion persists across browser tabs', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/');
    await second.goto('/');
    const shared1 = first.getByRole('region', { name: 'Either child' });
    const shared2 = second.getByRole('region', { name: 'Either child' });
    const checkbox = shared1.locator('label.chore').filter({ hasText: 'Feed pets' }).first().getByRole('checkbox');
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await second.reload();
    await expect(shared2.locator('label.chore').filter({ hasText: 'Feed pets' }).first().getByRole('checkbox')).toBeChecked();
  } finally { await context.close(); }
});

test('undoes an overdue completion before the window expires', async ({ page }) => {
  await page.goto('/');
  const laundry = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Put laundry away' });
  await laundry.getByRole('checkbox').click();
  await expect(laundry.getByRole('checkbox')).toBeChecked();
  await laundry.getByRole('checkbox').click();
  await expect(laundry.getByRole('checkbox')).not.toBeChecked();
  await page.reload();
  await expect(laundry.getByRole('checkbox')).not.toBeChecked();
});

test('completed overdue chore disappears after 30 seconds without reload', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const laundry = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Put laundry away' });
  await laundry.getByRole('checkbox').click();
  await expect(laundry.getByRole('checkbox')).toBeChecked();
  await page.clock.fastForward(31_000);
  await expect(laundry).toHaveCount(0);
});

test('does not show chores completed on previous days', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Yesterday completed test chore')).toHaveCount(0);
  await expect(page.getByText('Yesterday completed test chore')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Yesterday completed test chore')).toHaveCount(0);
});

test('keeps chores completed today visible and checked after reload', async ({ page }) => {
  await page.goto('/');
  const chore = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Today completed test chore' });
  await expect(chore).toBeVisible();
  await expect(chore.getByRole('checkbox')).toBeChecked();
  await page.reload();
  await expect(chore).toBeVisible();
  await expect(chore.getByRole('checkbox')).toBeChecked();
});

test('keeps overdue undo available across a dashboard refresh during the 30-second window', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const laundry = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Put laundry away' });
  const checkbox = laundry.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();

  await checkbox.click();
  await expect(checkbox).toBeChecked();

  // Force the same API refresh that periodic polling performs while still inside the undo window.
  await page.clock.fastForward(15_000);
  const responses = page.waitForResponse(response => /\/api\/chores\?date=\d{4}-\d{2}-\d{2}&more=false/.test(response.url()) && response.status() === 200);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await responses;
  await expect(checkbox).toBeChecked();

  // Undo remains available while the grace period has not expired.
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await page.reload();
  await expect(laundry.getByRole('checkbox')).not.toBeChecked();
});

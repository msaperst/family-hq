import { expect, test } from '@playwright/test';

test('renders dynamic columns and overdue work from SQLite', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Family HQ' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Porter' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Miller' })).toBeVisible();
  const shared = page.getByRole('region', { name: 'Either child' });
  await expect(shared).toBeVisible();
  await expect(shared.getByText('Feed pets').first()).toBeVisible();
  const porter = page.getByRole('region', { name: 'Porter' });
  await expect(porter.getByText('Put laundry away')).toBeVisible();
  await expect(porter.getByText('Yesterday · Overdue')).toBeVisible();
  await expect(porter.getByText('Clean bedroom')).toBeVisible();
});
test('completes and unchecks a chore with persistence across reload', async ({ page }) => {
  await page.goto('/');
  const porter = page.getByRole('region', { name: 'Porter' });
  const laundry = porter.locator('label.chore').filter({ hasText: 'Put laundry away' });
  await laundry.getByRole('checkbox').click();
  await expect(laundry).toHaveCount(0);
  await page.reload();
  await expect(porter.getByText('Put laundry away')).toHaveCount(0);
  const bed = porter.locator('label.chore').filter({ hasText: 'Make bed' }).first();
  await bed.getByRole('checkbox').click();
  await expect(bed.getByRole('checkbox')).toBeChecked();
  await page.reload();
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox')).toBeChecked();
  await porter.locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox').click();
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox')).not.toBeChecked();
});
test('hides later daily chores until Show more is selected', async ({ page }) => {
  await page.goto('/');
  const porter = page.getByRole('region', { name: 'Porter' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
  const visibleCount = weekday === 0 ? 1 : 2;
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' })).toHaveCount(visibleCount);
  await page.getByRole('button', { name: 'Show more upcoming chores' }).click();
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' })).toHaveCount(7);
  await page.getByRole('button', { name: 'Hide upcoming chores' }).click();
  await expect(porter.locator('label.chore').filter({ hasText: 'Make bed' })).toHaveCount(visibleCount);
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

import { expect } from '@playwright/test';
import { test } from './fixture.js';

test('shows active child columns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Miller' })).toBeVisible();
});
test('shows a single shared column', async ({ page }) => {
  await page.goto('/');
  const shared = page.getByRole('region', { name: 'Either child' });
  await expect(shared.locator('label.chore').filter({ hasText: 'Feed pets' })).toHaveCount(1);
});
test('shows overdue chores with their original due date', async ({ page }) => {
  await page.goto('/');
  const porter = page.getByRole('region', { name: 'Porter' });
  await expect(porter.getByText('Put laundry away')).toBeVisible();
  await expect(porter.getByText('Yesterday · Overdue')).toBeVisible();
});
test('shows flexible weekly chores before the deadline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Clean bedroom')).toBeVisible();
});
test('removes a completed overdue chore after reload', async ({ page }) => {
  await page.goto('/');
  const laundry = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Put laundry away' });
  await laundry.getByRole('checkbox').click();
  await expect(laundry).toHaveCount(0);
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

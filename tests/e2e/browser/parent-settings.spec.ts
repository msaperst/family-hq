import { expect } from '@playwright/test';
import { test } from './fixture.js';

test('creates a recurring chore and displays it on the dashboard', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Parent settings', exact: false })).toBeVisible();
  await page.getByLabel('Chore name').fill('Playwright new chore');
  await page.getByLabel('Porter').check();
  await page.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByText('Playwright new chore').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Playwright new chore')).toBeVisible();
});

test('edits and pauses a recurring chore without changing completed history', async ({ page }) => {
  await page.goto('/settings');
  const item = page.locator('.schedule-list li').filter({ hasText: 'Clean bedroom' }).first();
  await item.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Anytime during the week, due Sunday')).toBeChecked();
  await page.getByLabel('Chore name').fill('Tidy bedroom');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.schedule-list li').filter({ hasText: 'Tidy bedroom' }).first()).toBeVisible();
  const edited = page.locator('.schedule-list li').filter({ hasText: 'Tidy bedroom' }).first();
  await edited.getByRole('button', { name: 'Pause' }).click();
  await expect(edited.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Tidy bedroom')).toHaveCount(0);
  await page.goto('/settings');
  await page.locator('.schedule-list li').filter({ hasText: 'Tidy bedroom' }).first().getByRole('button', { name: 'Resume' }).click();
  await page.goto('/');
  await expect(page.getByText('Tidy bedroom')).toBeVisible();
});

test('skips and restores one occurrence without changing the weekly rule', async ({ page }) => {
  await page.goto('/settings');
  await page.locator('.schedule-list li').filter({ hasText: 'Clean bedroom' }).first()
    .getByRole('button', { name: 'Edit' }).click();
  const preview = page.getByRole('heading', { name: 'Upcoming occurrences' }).locator('..');
  await expect(preview.getByRole('button', { name: 'Exception' }).first()).toBeVisible();
  await preview.getByRole('button', { name: 'Exception' }).last().click();
  await page.getByRole('button', { name: 'Save exception' }).click();
  await expect(page.getByText(/: skip/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(/: skip/)).toHaveCount(0);
});

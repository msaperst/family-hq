import { expect } from '@playwright/test';
import { test } from './fixture.js';

test('adds and renames a child, then assigns a chore through Parent Settings', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Child name').fill('Alex');
  await page.getByRole('button', { name: 'Add child' }).click();
  const child = page.locator('.settings-panel').filter({ has: page.getByRole('heading', { name: 'Children' }) });
  await expect(child.getByText('Alex')).toBeVisible();
  await child.locator('.schedule-list li').filter({ hasText: 'Alex' }).getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Rename child').fill('Taylor');
  await page.getByRole('button', { name: 'Save child name' }).click();
  await expect(child.getByText('Taylor')).toBeVisible();
  await page.getByLabel('Chore name').fill('Sort books');
  await page.getByLabel('Taylor').check();
  await page.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByText('Sort books').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Taylor' }).getByText('Sort books').first()).toBeVisible();
});

test('deletes an unused child after confirmation', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Child name').fill('Temporary');
  await page.getByRole('button', { name: 'Add child' }).click();
  const childRow = page.locator('.settings-panel').filter({ has: page.getByRole('heading', { name: 'Children' }) })
    .locator('.schedule-list li').filter({ hasText: 'Temporary' });
  await expect(childRow).toBeVisible();
  page.once('dialog', dialog => void dialog.accept());
  await childRow.getByRole('button', { name: 'Delete' }).click();
  await expect(childRow).toHaveCount(0);
});

test('creates a recurring chore and displays it on the dashboard', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Parent settings', exact: false })).toBeVisible();
  await page.getByLabel('Chore name').fill('Playwright new chore');
  await page.getByLabel('Porter').check();
  await page.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.getByText('Playwright new chore').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Playwright new chore').first()).toBeVisible();
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
  await expect(page.getByText('Tidy bedroom').first()).toBeVisible();
});

test('skips and restores one occurrence without changing the weekly rule', async ({ page }) => {
  await page.goto('/settings');
  await page.locator('.schedule-list li').filter({ hasText: 'Clean bedroom' }).first()
    .getByRole('button', { name: 'Edit' }).click();
  const preview = page.getByRole('heading', { name: 'Upcoming occurrences' }).locator('..');
  await expect(preview.getByRole('button', { name: 'Exception', exact: true }).first()).toBeVisible();
  await preview.getByRole('button', { name: 'Exception', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save exception' }).click();
  await expect(page.getByText(/: skip/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(/: skip/)).toHaveCount(0);
});

test('canceling edit removes exception actions and preserves the schedule', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/parent/schedules/') &&
        ['PUT', 'POST', 'DELETE', 'PATCH'].includes(request.method())) {
      mutations.push(request.method() + ' ' + request.url());
    }
  });
  await page.goto('/settings');
  const item = page.locator('.schedule-list li').filter({ hasText: 'Clean bedroom' }).first();
  await item.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming occurrences' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming occurrences' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save exception' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Add a chore' })).toBeVisible();
  await expect(item).toContainText('Clean bedroom');
  expect(mutations).toEqual([]);
});

test('exception removal stays disabled while a delete is pending', async ({ page }) => {
  await page.goto('/settings');
  await page.locator('.schedule-list li').filter({ hasText: 'Clean bedroom' }).first()
    .getByRole('button', { name: 'Edit' }).click();
  const preview = page.getByRole('heading', { name: 'Upcoming occurrences' }).locator('..');
  await preview.getByRole('button', { name: 'Exception', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save exception' }).click();
  const remove = page.getByRole('button', { name: 'Remove' });
  await expect(remove).toBeVisible();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  let deletes = 0;
  await page.route('**/api/parent/schedules/*/exceptions/*', async route => {
    if (route.request().method() !== 'DELETE') { await route.continue(); return; }
    deletes++;
    started();
    await blocked;
    await route.continue();
  });
  try {
    await remove.click();
    await requested;
    await expect(remove).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel editing' })).toBeDisabled();
    expect(deletes).toBe(1);
  } finally {
    release();
  }
  await expect(remove).toHaveCount(0);
  expect(deletes).toBe(1);
});

test('changing today’s generated individual bed chore to each child keeps the dashboard working', async ({ page }) => {
  // Opening the dashboard first persists today's individual occurrence.
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Make bed').first()).toBeVisible();

  await page.goto('/settings');
  const porterBed = page.locator('.schedule-list li')
    .filter({ hasText: 'Make bed' }).filter({ hasText: 'Porter' }).first();
  await porterBed.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Who completes it?').selectOption('each');
  await page.getByLabel('Porter').check();
  await page.getByLabel('Miller').check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(porterBed).toContainText('Porter, Miller');

  const failures: number[] = [];
  page.on('response', response => {
    if (response.url().includes('/api/chores') && response.status() >= 500) failures.push(response.status());
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Porter' }).getByText('Make bed').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Miller' }).getByText('Make bed').first()).toBeVisible();
  expect(failures).toEqual([]);
});

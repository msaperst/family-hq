import { expect } from '@playwright/test';
import { test } from './fixture.js';

test('navigates from family dashboard to history and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Chore history/ }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole('heading', { name: 'Chore history' })).toBeVisible();
  await page.getByRole('link', { name: /Family HQ/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('displays daily breakdown, changes period and filters by child', async ({ page }) => {
  const records = [
    { id: 'a', name: 'Dishes', dueOn: '2026-10-26', childId: 'alex', childName: 'Alex', status: 'completed' },
    { id: 'b', name: 'Laundry', dueOn: '2026-10-26', childId: 'alex', childName: 'Alex', status: 'skipped' },
    { id: 'c', name: 'Feed pets', dueOn: '2026-10-25', childId: 'sam', childName: 'Sam', status: 'outstanding' },
  ];
  const calls: string[] = [];
  await page.route('**/api/history?days=*', route => {
    const url = new URL(route.request().url());
    calls.push(url.searchParams.get('days') ?? '');
    const days = url.searchParams.get('days');
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ from: days === '30' ? '2026-09-27' : '2026-10-20',
        through: '2026-10-26', today: '2026-10-26', entries: records }),
    });
  });
  await page.goto('/history');
  const metrics = page.getByRole('region', { name: 'Chore summary' });
  await expect(metrics.getByText('33%')).toBeVisible();
  await expect(metrics.getByText('1 of 3 scheduled')).toBeVisible();
  await expect(page.getByText('Dishes')).toBeVisible();
  await expect(page.getByText('Laundry')).toBeVisible();
  await page.getByRole('combobox', { name: 'Child' }).selectOption('alex');
  await expect(metrics.getByText('50%')).toBeVisible();
  await expect(page.getByText('Feed pets')).toHaveCount(0);
  await page.getByRole('button', { name: '30 days' }).click();
  await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => calls.includes('30')).toBe(true);
  await expect(page.locator('.history-bar-row')).toHaveCount(30);
});

test('shows empty history and handles failed requests', async ({ page }) => {
  await page.route('**/api/history?days=*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      from: '2026-10-20', through: '2026-10-26', today: '2026-10-26', entries: [],
    }),
  }));
  await page.goto('/history');
  await expect(page.getByText('0 of 0 scheduled')).toBeVisible();
  await expect(page.locator('.history-bar-row')).toHaveCount(7);
  await page.unrouteAll();
  await page.route('**/api/history?days=*', route => route.fulfill({ status: 500, body: '{}' }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Unable to load chore history');
});

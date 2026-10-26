import { expect } from '@playwright/test';
import { test } from './fixture.js';

const alexChore = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('region', { name: 'Alex' }).locator('.swipe-chore').filter({ hasText: name }).first();

async function revealByDrag(page: import('@playwright/test').Page, name: string) {
  const row = alexChore(page, name);
  const bounds = await row.locator('.swipe-face').boundingBox();
  if (!bounds) throw new Error('Chore row missing');
  const x = bounds.x + bounds.width * .7;
  const y = bounds.y + bounds.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 110, y, { steps: 8 });
  await page.mouse.up();
  await expect(row).toHaveClass(/revealed/);
  return row;
}

test('mouse drag reveals Skip without changing the chore until the second click', async ({ page }) => {
  await page.goto('/');
  const row = await revealByDrag(page, 'Make bed');
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await expect(row).not.toHaveClass(/is-skipped/);
  await row.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row).toHaveClass(/is-skipped/);
  await expect(row.getByText(/Skipped/)).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Undo skip' })).toBeVisible();
  await page.reload();
  await expect(alexChore(page, 'Make bed')).toHaveClass(/is-skipped/);
  await alexChore(page, 'Make bed').getByRole('button', { name: 'Undo skip' }).click();
  await expect(alexChore(page, 'Make bed')).not.toHaveClass(/is-skipped/);
  await expect(alexChore(page, 'Make bed').getByRole('checkbox')).not.toBeChecked();
});

test('tap/click actions menu can reveal and dismiss without skipping', async ({ page }) => {
  await page.goto('/');
  const row = alexChore(page, 'Make bed');
  const menu = row.getByRole('button', { name: 'Actions for Make bed' });
  await menu.click();
  await expect(row).toHaveClass(/revealed/);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await menu.click();
  await expect(row).not.toHaveClass(/revealed/);
  await expect(row).not.toHaveClass(/is-skipped/);
});

test('vertical scrolling or short horizontal movement does not reveal or skip', async ({ page }) => {
  await page.goto('/');
  const row = alexChore(page, 'Make bed');
  const bounds = await row.locator('.swipe-face').boundingBox();
  if (!bounds) throw new Error('Chore missing');
  const x = bounds.x + bounds.width * .6;
  const y = bounds.y + bounds.height * .4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 15, y + 75, { steps: 5 });
  await page.mouse.up();
  await expect(row).not.toHaveClass(/revealed/);
  await expect(row).not.toHaveClass(/is-skipped/);
});

test('overdue skip stays 30 seconds for undo, then disappears', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const row = alexChore(page, 'Put laundry away');
  await row.getByRole('button', { name: 'Actions for Put laundry away' }).click();
  await row.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row).toHaveClass(/is-skipped/);
  await expect(row.getByRole('button', { name: 'Undo skip' })).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(alexChore(page, 'Put laundry away')).toHaveCount(0);
});

test('overdue skip can be undone during the grace period', async ({ page }) => {
  await page.goto('/');
  const row = alexChore(page, 'Put laundry away');
  await row.getByRole('button', { name: 'Actions for Put laundry away' }).click();
  await row.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row).toHaveClass(/is-skipped/);
  await row.getByRole('button', { name: 'Undo skip' }).click();
  await expect(row).not.toHaveClass(/is-skipped/);
  await page.reload();
  await expect(alexChore(page, 'Put laundry away')).toBeVisible();
});

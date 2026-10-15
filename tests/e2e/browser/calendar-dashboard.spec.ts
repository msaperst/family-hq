import { expect } from '@playwright/test';
import { test } from './fixture.js';

const TODAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const shift = (days: number) => new Date(Date.parse(TODAY + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
const timed = (id: string, day: string) => ({
  id, title: id, start: day + 'T18:00:00Z', end: day + 'T19:00:00Z', allDay: false, location: 'Community center',
});

test('renders calendar beside chores at landscape tablet size', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.route('**/api/calendar/events?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [timed('Family appointment', shift(1))], stale: false }),
  }));
  await page.goto('/');
  const chores = page.getByRole('region', { name: 'Porter' });
  const calendar = page.getByRole('region', { name: 'Family calendar' });
  await expect(chores).toBeVisible();
  await expect(calendar.getByText('Family appointment')).toBeVisible();
  const choresBox = await chores.boundingBox();
  const calendarBox = await calendar.boundingBox();
  expect(choresBox).not.toBeNull();
  expect(calendarBox).not.toBeNull();
  expect(calendarBox!.x).toBeGreaterThan(choresBox!.x + choresBox!.width);
  expect(calendarBox!.y).toBeLessThan(choresBox!.y + choresBox!.height);
});

test('keeps chores before calendar on a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/calendar/events?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [timed('Family appointment', shift(1))], stale: false }),
  }));
  await page.goto('/');
  const chores = page.getByRole('region', { name: 'Porter' });
  const calendar = page.getByRole('region', { name: 'Family calendar' });
  await expect(chores).toBeVisible();
  await expect(calendar.getByText('Family appointment')).toBeVisible();
  const choresBox = await chores.boundingBox();
  const calendarBox = await calendar.boundingBox();
  expect(choresBox).not.toBeNull();
  expect(calendarBox).not.toBeNull();
  expect(calendarBox!.y).toBeGreaterThan(choresBox!.y);
});

test('calendar outage leaves chores usable', async ({ page }) => {
  await page.route('**/api/calendar/events?*', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Calendar unavailable' }),
  }));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Family calendar' }).getByRole('alert')).toHaveText('Unable to load calendar');
  await expect(page.getByRole('region', { name: 'Family calendar' }).getByRole('button', { name: 'Load more events' })).toHaveCount(0);
  const bed = page.getByRole('region', { name: 'Porter' }).locator('label.chore').filter({ hasText: 'Make bed' }).first().getByRole('checkbox');
  await bed.click();
  await expect(bed).toBeChecked();
});

test('loads the next calendar window without losing existing events', async ({ page }) => {
  const windows: string[] = [];
  await page.route('**/api/calendar/events?*', async route => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from')!;
    windows.push(from);
    const events = from === TODAY ? [timed('First week', shift(1))] : [timed('Second week', shift(8))];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events, stale: false }) });
  });
  await page.goto('/');
  const calendar = page.getByRole('region', { name: 'Family calendar' });
  await expect(calendar.getByText('First week')).toBeVisible();
  await calendar.getByRole('button', { name: 'Load more events' }).click();
  await expect(calendar.getByText('Second week')).toBeVisible();
  await expect(calendar.getByText('First week')).toBeVisible();
  expect(windows).toContain(TODAY);
  expect(windows).toContain(shift(7));
});

test('shows cached calendar warning while chores remain visible', async ({ page }) => {
  await page.route('**/api/calendar/events?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [timed('Saved appointment', shift(1))], stale: true }),
  }));
  await page.goto('/');
  const calendar = page.getByRole('region', { name: 'Family calendar' });
  await expect(calendar.getByRole('status')).toHaveText('Showing saved calendar events');
  await expect(calendar.getByText('Saved appointment')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Porter' })).toBeVisible();
});

test('both service failures keep the chore columns and calendar panel visible', async ({ page }) => {
  await page.route('**/api/chores?*', route => route.fulfill({ status: 503, body: '{}' }));
  await page.route('**/api/calendar/events?*', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Chores' }).getByRole('alert')).toHaveText('Unable to load chores');
  await expect(page.getByRole('region', { name: 'Porter' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Family calendar' }).getByRole('alert')).toHaveText('Unable to load calendar');
  await expect(page.locator('.dashboard-header .connection')).toHaveCount(0);
});

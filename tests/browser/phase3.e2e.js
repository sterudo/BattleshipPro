import { expect, test } from '@playwright/test';

async function selectLocalMode(page) {
  await page.getByRole('radio', { name: /Local two-player/ }).click();
}

async function placeFleet(page, firstRow = 0, lastRow = 5) {
  const cells = page.locator('.boards .board-panel').first().locator('.cell');
  for (let row = firstRow; row < lastRow; row += 1) {
    await cells.nth(row * 10).click();
  }
}

test('local fleets stay private, turns pass on misses, and the named result replays after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { Math.random = () => 0; });
  await selectLocalMode(page);
  await page.getByLabel('Player 1 name').fill('  Admiral One  ');
  await page.getByLabel('Player 2 name').fill('Admiral Two');

  await placeFleet(page);
  await expect(page.getByText('5 / 5 vessels placed')).toBeVisible();
  await expect(page.locator('.boards .is-ship')).toHaveCount(17);
  await expect(page.locator('.boards .board-ship')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Clear fleet' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear fleet' }).click();
  await expect(page.locator('.boards .is-ship')).toHaveCount(0);
  await page.getByRole('button', { name: /Randomize/ }).click();
  await expect(page.locator('.boards .is-ship')).toHaveCount(17);
  await expect(page.getByText('5 / 5 vessels placed')).toBeVisible();
  await expect(page.locator('.boards .board-panel')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pass device to Admiral Two' }).click();
  await expect(page.getByRole('heading', { name: 'Pass the device to Admiral Two' })).toBeVisible();
  await expect(page.locator('.board-panel')).toHaveCount(0);
  await expect(page.getByLabel(/Carrier ship/)).toHaveCount(0);

  await page.getByRole('button', { name: /Ready for Admiral Two/ }).click();
  await expect(page.locator('.board-panel')).toHaveCount(1);
  await placeFleet(page, 0, 1);
  await expect(page.locator('.board-panel .is-ship')).toHaveCount(5);
  await expect(page.getByLabel(/Carrier ship/)).toHaveCount(5);
  await placeFleet(page, 1, 5);
  await expect(page.getByText('5 / 5 vessels placed')).toBeVisible();
  await expect(page.locator('.boards .is-ship')).toHaveCount(17);
  await expect(page.locator('.boards .board-ship')).toHaveCount(5);
  await page.getByRole('button', { name: 'Continue to first shooter' }).click();
  await expect(page.getByRole('heading', { name: 'Admiral One fires first' })).toBeVisible();

  await page.getByRole('button', { name: 'Start battle' }).click();
  const boards = page.locator('.boards .board-panel');
  await expect(boards).toHaveCount(2);
  await expect(page.locator('.boards .is-ship, .boards .board-ship')).toHaveCount(0);
  await expect(boards.nth(0).locator('.cell').first()).toBeDisabled();
  await expect(boards.nth(1).locator('.cell').first()).toBeEnabled();
  await expect(boards.nth(0).locator('.cell').first()).toHaveAttribute('aria-label', /open water/);
  await expect(boards.nth(1).locator('.cell').first()).toHaveAttribute('aria-label', /open water/);
  await expect(page.locator('.turn-banner strong')).toHaveText('Admiral One to fire');

  await boards.nth(1).locator('.cell').nth(99).click();
  await expect(page.locator('.turn-banner strong')).toHaveText('Admiral Two to fire');
  await expect(boards.nth(0).locator('.cell').first()).toBeEnabled();
  await expect(boards.nth(1).locator('.cell').first()).toBeDisabled();
  await boards.nth(0).locator('.cell').nth(98).click();
  await expect(page.locator('.turn-banner strong')).toHaveText('Admiral One to fire');

  const target = boards.nth(1).locator('.cell');
  const fleetCells = [
    ...Array.from({ length: 5 }, (_, column) => [0, column]),
    ...Array.from({ length: 4 }, (_, column) => [1, column]),
    ...Array.from({ length: 3 }, (_, column) => [2, column]),
    ...Array.from({ length: 3 }, (_, column) => [3, column]),
    ...Array.from({ length: 2 }, (_, column) => [4, column]),
  ];
  for (const [row, column] of fleetCells) {
    await target.nth(row * 10 + column).click();
  }

  await expect(page.getByRole('heading', { name: 'Admiral One wins' })).toBeVisible();
  await expect(page.locator('.boards .board-ship')).toHaveCount(10);
  await expect(page.getByText(/Admiral One won/)).toBeVisible();
  const persistedProgress = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('fleet-command.player-progress.v1'))
  ));
  expect(persistedProgress.profiles.find(({ normalizedName }) => normalizedName === 'admiral one').lifetimeWins).toBe(1);
  expect(persistedProgress.profiles.find(({ normalizedName }) => normalizedName === 'admiral two').achievements)
    .toContain('short-battle');

  await page.getByRole('button', { name: 'New local match' }).click();
  await expect(page.locator('.boards .board-panel')).toHaveCount(1);
  await expect(page.locator('.boards .is-ship')).toHaveCount(0);
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Admiral One');
  await expect(page.getByLabel('Player 2 name')).toHaveValue('Admiral Two');
  await page.reload();
  await page.getByRole('button', { name: /Admiral One won/ }).click();
  await expect(page.getByRole('heading', { name: /Admiral One won · Local two-player/ })).toBeVisible();
  await expect(page.locator('.replay-boards .board-panel')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next shot' }).click();
  await expect(page.getByText('Shot 1 of 19')).toBeVisible();
  const reloadedProgress = await page.evaluate(() => (
    JSON.parse(localStorage.getItem('fleet-command.player-progress.v1'))
  ));
  expect(reloadedProgress.profiles.find(({ normalizedName }) => normalizedName === 'admiral one').lifetimeWins).toBe(1);

  await page.getByRole('button', { name: 'Close replay' }).click();
  await selectLocalMode(page);
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Admiral One');
  await expect(page.getByLabel('Player 2 name')).toHaveValue('Admiral Two');
  await page.getByRole('radio', { name: /^Solo/ }).click();
  await expect(page.getByLabel('Player 1 name')).toHaveValue('Admiral One');
});

test('cancelling a mode change preserves a partially placed match and duplicate names block handoff', async ({ page }) => {
  await page.goto('/');
  await selectLocalMode(page);
  await page.getByLabel('Player 1 name').fill('Same');
  await page.getByLabel('Player 2 name').fill('  same ');
  await page.locator('[data-placement-cell]').first().click();
  await expect(page.getByRole('alert')).toContainText('different names');
  await expect(page.locator('.boards .is-ship')).toHaveCount(5);
  await page.on('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('radio', { name: /^Solo/ }).click();
  await expect(page.getByRole('radio', { name: /Local two-player/ })).toBeChecked();
  await expect(page.locator('.boards .is-ship')).toHaveCount(5);
});

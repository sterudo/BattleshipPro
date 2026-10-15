import { expect, test } from '@playwright/test';

async function touchDrag(page, source, target, { cancel = false } = {}) {
  await source.evaluate((element) => {
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 40);
  });
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  const session = await page.context().newCDPSession(page);
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 8; step += 1) {
    const ratio = step / 8;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }],
    });
  }
  await session.send('Input.dispatchTouchEvent', {
    type: cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  });
  await session.detach();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('touch drag places an oriented ship, rejects overlap, and handles cancellation', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Requires a touch-enabled mobile browser.');
  await page.getByRole('button', { name: 'Horizontal' }).click();
  const cells = page.locator('[data-placement-cell]');
  const carrier = page.getByRole('button', { name: 'Carrier 5 cells' });
  await touchDrag(page, carrier, cells.nth(0));
  await expect(carrier).toBeDisabled();
  await expect(page.locator('.boards .board-panel').first().locator('.is-ship')).toHaveCount(5);
  await expect(cells.nth(40)).toHaveAttribute('aria-label', /Carrier ship/);
  await expect(cells.nth(1)).toHaveAttribute('aria-label', /open water/);

  const battleship = page.getByRole('button', { name: 'Battleship 4 cells' });
  await touchDrag(page, battleship, cells.nth(0));
  await expect(page.getByRole('alert')).toContainText('cannot overlap');
  await expect(battleship).toBeEnabled();
  await touchDrag(page, battleship, cells.nth(1), { cancel: true });
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect(battleship).toBeEnabled();
  await touchDrag(page, battleship, cells.nth(1));
  await expect(battleship).toBeDisabled();
  await expect(page.locator('.boards .board-panel').first().locator('.is-ship')).toHaveCount(9);
});

test('mouse drag and keyboard click placement remain available', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop mouse and keyboard path.');
  const carrier = page.getByRole('button', { name: 'Carrier 5 cells' });
  const cell = page.locator('[data-placement-cell]').first();
  await carrier.evaluate((element) => {
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 40);
  });
  const from = await carrier.boundingBox();
  const to = await cell.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(carrier).toBeDisabled();
  const destroyer = page.getByRole('button', { name: 'Destroyer 2 cells' });
  await destroyer.focus();
  await page.keyboard.press('Enter');
  const nextCell = page.locator('[data-placement-cell]').nth(10);
  await nextCell.focus();
  await page.keyboard.press('Enter');
  await expect(destroyer).toBeDisabled();
  await expect(page.locator('.boards .board-panel').first().locator('.is-ship')).toHaveCount(7);
});

test('restarting while AI waits cannot fire early or suppress the new match loop', async ({ page }) => {
  await page.evaluate(() => { Math.random = () => 0.99; });
  const time = new Date('2026-10-15T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.getByRole('button', { name: 'Randomize' }).click();
  await page.getByRole('button', { name: 'Begin engagement' }).click();
  await expect(page.locator('.status-line')).toContainText('Computer firing');
  await page.clock.runFor(200);
  await page.locator('.brand').click();
  await page.getByRole('button', { name: 'Randomize' }).click();
  await page.getByRole('button', { name: 'Begin engagement' }).click();
  const shots = page.locator('.boards .board-panel').first().locator('.board-count');
  await expect(shots).toHaveText('0 shots');
  await page.clock.runFor(221);
  await expect(shots).toHaveText('0 shots');
  await expect(page.locator('.status-line')).toContainText('Computer firing');
  await page.clock.runFor(199);
  await expect(shots).toHaveText('1 shots');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

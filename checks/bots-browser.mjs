import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createApp } from '../server/http.js';
import { matchRules } from '../server/match-rules.js';
import { openStore } from '../server/store.js';

test('a solo host can manage bots, deal, and reach the first sheriff election on a phone-sized screen', { timeout: 45_000 }, async t => {
  const store = openStore(':memory:');
  const app = createApp(store, { matchRules }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    store.close();
  });
  await once(app, 'listening');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(7_000);
    const button = name => page.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog');
    const manage = page.locator('[data-action=manage]');
    const botSeats = page.locator('.seat').filter({ hasText: '机器人' });

    // Wolf Beauty cannot self-destruct, so a random interruption cannot skip this election.
    await page.goto('http://127.0.0.1:' + app.address().port + '/create/custom');
    const role = name => page.locator(`[data-action=custom-role][data-value=${name}]`);
    await role('wolfBeauty').click();
    await button('好人阵营').click();
    await role('seer').click();
    await role('hunter').click();
    for (let index = 0; index < 9; index++) await role('villager').click();
    await button('确认创建').click();
    await page.getByLabel('你的昵称').fill('单人测试');
    await dialog.getByRole('button', { name: '确认创建' }).click();
    await manage.click();
    await button('添加机器人').click();
    await dialog.getByRole('combobox').selectOption('7');
    await button('确定').click();
    const seatSeven = page.locator('.seat').nth(6);
    await seatSeven.filter({ hasText: '机器人' }).waitFor();
    assert.equal(await botSeats.count(), 1);
    assert.equal(await seatSeven.locator('.seat-avatar').innerText(), '🤖');

    await manage.click();
    assert.equal(await button('转交房主').isDisabled(), true);
    await dialog.getByRole('button', { name: '移除', exact: true }).click();
    await button('确认移除').click();
    await seatSeven.filter({ hasText: '空座位' }).waitFor();
    await button('用机器人填满空位').click();
    await page.getByText('12 / 12 已入座', { exact: true }).waitFor();
    assert.equal(await botSeats.count(), 11);
    assert.equal(await page.locator('.seat.mine .seat-name').innerText(), '1:单人测试');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);

    await button('发放身份').click();
    await button('确认发放').click();
    await page.getByText('11 / 12 已准备', { exact: true }).waitFor();
    await button('查看我的身份').click();
    await button('我知道了').click();
    await button('准备就绪').click();
    await button('确定').click();
    await button('开始游戏').click();
    await dialog.getByRole('button', { name: '开始游戏', exact: true }).click();

    // The host's randomly dealt role can require a private choice during night one.
    const nightAction = page.locator('.match-actions .night-action');
    const election = button('开始警长竞选');
    await nightAction.or(election).waitFor();
    while (await nightAction.isVisible()) {
      await nightAction.click();
      await dialog.getByRole('radio').first().check();
      await dialog.getByRole('button', { name: '确认', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await nightAction.or(election).waitFor();
    }
    await election.click();
    await button('不上警').waitFor();
    assert.equal(await botSeats.count(), 11);
  } finally {
    await browser.close();
  }
});

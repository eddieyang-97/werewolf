import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../server/http.js';
import { openStore } from '../server/store.js';

const photo = fileURLToPath(new URL('../public/art/seer.png', import.meta.url));

async function createForm(page, origin) {
  await page.goto(origin + '/create');
  await page.locator('[data-action="create-details"]').click();
  return page.locator('form[data-form="create"]');
}

async function createRoom(page, origin, name, withPhoto = false) {
  const form = await createForm(page, origin);
  await form.locator('[name=nickname]').fill(name);
  if (withPhoto) {
    await form.locator('[name=avatar]').setInputFiles(photo);
    await form.locator('.avatar-preview').waitFor();
  }
  await form.locator('[type=submit]').click();
  await page.locator('[data-action=profile]:enabled').waitFor();
  return page.url();
}

async function loseRemovalResponse(page, roomUrl) {
  const code = new URL(roomUrl).pathname.split('/').at(-1);
  const endpoint = '**/api/rooms/' + code;
  let committed = false;
  await page.route(endpoint + '/sync', route => committed ? route.abort() : route.continue());
  await page.route(endpoint + '/action', async route => {
    const accepted = await route.fetch();
    assert.equal(accepted.status(), 200);
    assert.equal((await accepted.json()).room.self.avatar, null);
    committed = true;
    await route.abort();
  }, { times: 1 });

  await page.locator('[data-action=profile]').click();
  const edit = page.locator('form[data-form="profile"]');
  await edit.locator('[data-action=clear-avatar]').click();
  await edit.locator('[type=submit]').click();
  await page.locator('#notice').filter({ hasText: '连接中断' }).waitFor();
}

test('a lost avatar removal is recovered on reconnect without overwriting a newer room profile', { timeout: 30_000 }, async t => {
  const store = openStore(':memory:');
  const app = createApp(store).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    store.close();
  });
  await once(app, 'listening');
  const origin = 'http://127.0.0.1:' + app.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());

  for (const newerProfile of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5_000);
      const roomUrl = await createRoom(page, origin, 'Original Host', true);
      await loseRemovalResponse(page, roomUrl);
      if (newerProfile) {
        await createRoom(page, origin, 'Newer Host', true);
        await page.goto(roomUrl);
      } else {
        await page.reload();
      }
      await page.locator('[data-action=profile]:enabled').waitFor();
      await page.locator('[data-action=profile]').click();
      assert.equal(await page.locator('form[data-form=profile] .avatar-preview').isVisible(), false);

      const nextForm = await createForm(page, origin);
      assert.equal(await nextForm.locator('[name=nickname]').inputValue(), newerProfile ? 'Newer Host' : 'Original Host');
      assert.equal(await nextForm.locator('.avatar-preview').isVisible(), newerProfile);
    } finally {
      await context.close();
    }
  }
});

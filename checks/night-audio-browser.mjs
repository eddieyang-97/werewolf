import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createApp } from '../server/http.js';
import { matchRules } from '../server/match-rules.js';
import { nightChoiceDuration } from '../server/night-actions.js';
import { createRooms, tokenKey } from '../server/rooms.js';
import { openStore } from '../server/store.js';

test('the host finishes a delayed wake-up call before the full action window begins', { timeout: 30_000 }, async t => {
  let now = Date.now();
  const clock = () => now;
  const code = 'ABCDEF';
  const store = openStore(':memory:');
  const rooms = createRooms(store, clock, matchRules);
  const lineup = ['villager', 'guard', 'wolf'];
  const players = lineup.map((role, index) => {
    const token = randomBytes(32).toString('hex');
    return { token, guest: { key: tokenKey(token), id: randomUUID(), tab: randomUUID(), name: `玩家${index + 1}`,
      seat: index + 1, lastSeen: now, assignment: { role }, avatar: null, revealed: true, acknowledged: true, receipts: [] } };
  });
  const [host, guard] = players;
  store.create({ code, board: 'custom', lineup, hostId: host.guest.id, guests: players.map(player => player.guest),
    dealt: true, expiresAt: now + 86_400_000 }, host.guest.key, now);
  const app = createApp(store, { clock, matchRules }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve));
    store.close();
  });
  await once(app, 'listening');
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(7_000);
  await page.addInitScript(({ code, token }) => {
    localStorage.setItem(`werewolf-room-${code}`, token);
    window.calls = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      speak(call) { if (call.text) window.calls.push(call); },
      cancel() { if (window.calls.length) window.canceled = true; },
    } });
  }, { code, token: host.token });

  const { promise: started, resolve: recordStart } = Promise.withResolvers();
  const { promise: release, resolve: releaseStart } = Promise.withResolvers();
  await page.route(`**/api/rooms/${code}/action`, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    host.guest.tab = route.request().postDataJSON().tab;
    recordStart();
    await release;
    await route.fulfill({ response });
  }, { times: 1 });

  function elapse(milliseconds) {
    while (milliseconds > 0) {
      const tick = Math.min(5_000, milliseconds);
      milliseconds -= tick;
      now += tick;
      for (const { token, guest } of players) rooms.sync(code, token, guest.tab);
    }
  }

  function guardSync(playbackComplete) {
    return page.waitForResponse(response => {
      if (!response.url().endsWith('/sync')) return false;
      const body = response.request().postDataJSON();
      return body?.seenNightCue?.role === 'guard' && body.nightCuePlaybackComplete === playbackComplete;
    }).then(response => response.json());
  }

  await page.goto(`http://127.0.0.1:${app.address().port}/room/${code}`);
  await page.locator('[data-action=confirm-start]').click();
  await page.locator('[name=night-narration]').check();
  await page.locator('[data-action=start-match]').click();
  await started;
  const { matchId, window } = rooms.sync(code, guard.token, guard.guest.tab).match;
  rooms.action(code, guard.token, guard.guest.tab, {
    id: randomUUID(), type: 'match-choice', matchId, window, kind: 'night-action', choice: null,
  });
  elapse(nightChoiceDuration * 3);
  const duringSpeech = guardSync(false);
  releaseStart();
  assert.equal((await duringSpeech).match.nightCue.role, 'guard');
  elapse(nightChoiceDuration * 3);
  assert.equal((await guardSync(false)).match.nightCue.role, 'guard');
  assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.text)), ['守卫请睁眼']);
  assert.equal(await page.evaluate(() => window.canceled), undefined);

  const afterSpeech = guardSync(true);
  await page.evaluate(() => window.calls[0].onend());
  assert.equal((await afterSpeech).match.nightCue.role, 'guard');
  elapse(nightChoiceDuration - 1);
  assert.equal((await guardSync(true)).match.nightCue.role, 'guard');
  elapse(1);
  assert.equal((await guardSync(true)).match.nightCue.role, 'wolf');
  await page.waitForFunction(() => window.calls.length === 2);
  assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.text)), ['守卫请睁眼', '狼人请睁眼']);
});

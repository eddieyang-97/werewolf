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

async function game(t) {
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
  async function playerPage(player) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(7_000);
    await page.addInitScript(({ code, token }) => localStorage.setItem(`werewolf-room-${code}`, token), { code, token: player.token });
    page.on('request', request => {
      if (request.url().endsWith(`/api/rooms/${code}/resume`)) player.guest.tab = request.postDataJSON().tab;
    });
    return page;
  }
  function elapse(milliseconds, online = players) {
    while (milliseconds > 0) {
      const tick = Math.min(5_000, milliseconds);
      milliseconds -= tick;
      now += tick;
      for (const { token, guest } of online) rooms.sync(code, token, guest.tab);
    }
  }
  return { code, host, guard, players, rooms, elapse, playerPage, url: `http://127.0.0.1:${app.address().port}/room/${code}` };
}

function syncResponse(page, matches) {
  return page.waitForResponse(response => response.url().endsWith('/sync') && matches(response.request().postDataJSON()))
    .then(response => response.json());
}

test('the host finishes a delayed wake-up call before the full action window begins', { timeout: 30_000 }, async t => {
  const { code, host, guard, rooms, elapse, playerPage, url } = await game(t);
  const page = await playerPage(host);
  await page.addInitScript(() => {
    window.calls = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      speak(call) { if (call.text) window.calls.push(call); },
      cancel() { if (window.calls.length) window.canceled = true; },
    } });
  });

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

  function guardSync(playbackComplete) {
    return syncResponse(page, body => body?.seenNightCue?.role === 'guard' && body.nightCuePlaybackComplete === playbackComplete);
  }

  await page.goto(url);
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

test('a muted host on match history cannot acknowledge a cue received behind it', { timeout: 30_000 }, async t => {
  const { code, host, rooms, elapse, playerPage, url } = await game(t);
  const page = await playerPage(host);
  await page.goto(url);
  await page.locator('[data-action=confirm-start]').waitFor();
  rooms.action(code, host.token, host.guest.tab, { id: randomUUID(), type: 'match-start', nightNarration: true });
  const call = page.locator('.night-call strong');
  await call.scrollIntoViewIfNeeded();
  await syncResponse(page, body => body.seenNightCue?.role === 'guard');

  const { promise: wolfReady, resolve: sawWolf } = Promise.withResolvers();
  const { promise: release, resolve: releaseWolf } = Promise.withResolvers();
  await page.route(`**/api/rooms/${code}/sync`, async route => {
    const response = await route.fetch();
    if ((await response.json()).match.nightCue?.role === 'wolf') {
      sawWolf();
      await release;
    }
    await route.fulfill({ response });
  }, { times: 1 });
  elapse(nightChoiceDuration);
  await wolfReady;
  await page.locator('[data-action=match-history]').click();
  assert.equal(await call.count(), 0);
  const hiddenPoll = syncResponse(page, () => true);
  releaseWolf();
  await hiddenPoll;
  const nextPoll = page.waitForRequest(request => request.url().endsWith('/sync'));
  assert.equal((await nextPoll).postDataJSON().seenNightCue, undefined);
  elapse(nightChoiceDuration * 2);
  assert.equal((await syncResponse(page, () => true)).match.nightCue.role, 'wolf');

  await page.locator('#home-link').click();
  await call.scrollIntoViewIfNeeded();
  assert.equal(await call.textContent(), '狼人请睁眼');
  assert.equal((await syncResponse(page, body => body.seenNightCue?.role === 'wolf')).match.nightCue.role, 'wolf');
});

test('an eligible player sees the live and paused timer and the dialog closes at expiry', { timeout: 30_000 }, async t => {
  const { code, host, guard, players, rooms, elapse, playerPage, url } = await game(t);
  const wolf = players[2];
  const { room: { match: { nightCue } } } = rooms.action(code, host.token, host.guest.tab, {
    id: randomUUID(), type: 'match-start', nightNarration: true,
  });
  const ack = () => rooms.sync(code, host.token, host.guest.tab, { seenNightCue: nightCue, nightCuePlaybackComplete: true });
  const page = await playerPage(guard);
  await page.addInitScript(() => {
    const now = performance.now.bind(performance);
    window.actionTimerOffset = 0;
    Object.defineProperty(performance, 'now', { value: () => now() + window.actionTimerOffset });
  });
  await page.goto(url);
  const control = page.locator('.night-action[data-action=match-control]');
  await control.click();
  const timer = page.locator('dialog [data-night-action-clock]');
  assert.equal(await timer.textContent(), '等待播报结束');
  ack();
  await timer.filter({ hasText: /^剩余 00:20$/ }).waitFor();
  elapse(8_000);
  rooms.disconnect(code, wolf.token, wolf.guest.tab);
  await timer.filter({ hasText: /^剩余 00:12（暂停）$/ }).waitFor();
  await page.evaluate(() => { window.actionTimerOffset += 20_000; });
  assert.equal(await timer.textContent(), '剩余 00:12（暂停）');

  rooms.sync(code, wolf.token, wolf.guest.tab);
  ack();
  await timer.filter({ hasText: /^剩余 00:12$/ }).waitFor();
  await page.evaluate(() => { window.actionTimerOffset += 12_000; });
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(await control.isDisabled(), true);
});

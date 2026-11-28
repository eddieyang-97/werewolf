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

async function game(t, { lineup = ['villager', 'guard', 'wolf'], customRules, sheriffMode } = {}) {
  let now = Date.now();
  const clock = () => now;
  const code = 'ABCDEF';
  const store = openStore(':memory:');
  const rooms = createRooms(store, clock, matchRules);
  const players = lineup.map((role, index) => {
    const token = randomBytes(32).toString('hex');
    return { token, guest: { key: tokenKey(token), id: randomUUID(), tab: randomUUID(), name: `玩家${index + 1}`,
      seat: index + 1, lastSeen: now, assignment: { role }, avatar: null, revealed: true, acknowledged: true, receipts: [] } };
  });
  const [host, guard] = players;
  store.create({ code, board: 'custom', lineup, customRules, sheriffMode, hostId: host.guest.id, guests: players.map(player => player.guest),
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

const showActions = page => page.getByRole('button', { name: '显示操作', exact: true });

test('night and self-destruct actions stay behind the same disclosure for wolf and village seats', { timeout: 30_000 }, async t => {
  const { host, players, playerPage, url } = await game(t, {
    lineup: ['villager', 'wolf', 'wolfKing', 'villager'],
    customRules: { victoryMode: 'town', firstNightKnife: 'disabled' },
  });
  const [hostPage, wolfPage] = await Promise.all([playerPage(host), playerPage(players[1])]);
  await Promise.all([hostPage.goto(url), wolfPage.goto(url)]);
  await hostPage.locator('[data-action=confirm-start]').click();
  await hostPage.locator('[data-action=start-match]').click();

  const noKill = page => page.getByRole('button', { name: '不击杀', exact: true });
  const selfDestruct = page => page.getByRole('button', { name: '自爆', exact: true });
  const nightPrompt = page => page.getByText('点击「显示操作」查看当前操作', { exact: true });
  await nightPrompt(hostPage).waitFor();
  await nightPrompt(wolfPage).waitFor();
  await showActions(wolfPage).waitFor();
  assert.equal(await noKill(wolfPage).count(), 0);
  assert.equal(await wolfPage.getByText('狼队同伴：3号', { exact: true }).count(), 0);
  await showActions(hostPage).click();
  await showActions(wolfPage).click();
  await noKill(wolfPage).waitFor();
  await wolfPage.getByText('狼队同伴：3号', { exact: true }).waitFor();
  assert.equal(await noKill(hostPage).count(), 0);
  assert.equal(await wolfPage.locator('[data-night-action-clock]').count(), 0);
  await noKill(wolfPage).click();
  await wolfPage.getByText('等待公布昨夜信息', { exact: true }).waitFor();
  assert.equal(await selfDestruct(wolfPage).count(), 0);
  await showActions(hostPage).click();
  assert.equal(await selfDestruct(hostPage).count(), 0);
  await showActions(wolfPage).click();
  await selfDestruct(wolfPage).click();
  const dialog = wolfPage.getByRole('dialog');
  await dialog.getByText('自爆后你将出局。').waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await wolfPage.getByRole('button', { name: '隐藏操作', exact: true }).click();
  assert.equal(await selfDestruct(wolfPage).count(), 0);
});

test('a failed sync or brief offline event closes the private Witch prompt until actions are shown again', { timeout: 30_000 }, async t => {
  const { code, host, players, rooms, elapse, playerPage, url } = await game(t, {
    lineup: ['villager', 'witch', 'wolf', 'villager'],
  });
  const [, witch, wolf] = players;
  const { room: { match: { nightCue } } } = rooms.action(code, host.token, host.guest.tab, {
    id: randomUUID(), type: 'match-start', nightNarration: true,
  });
  const hearCue = seenNightCue => rooms.sync(code, host.token, host.guest.tab, { seenNightCue, nightCuePlaybackComplete: true });
  assert.equal(nightCue.role, 'wolf');
  hearCue(nightCue);
  const { matchId, window } = rooms.sync(code, wolf.token, wolf.guest.tab).match;
  rooms.action(code, wolf.token, wolf.guest.tab, { id: randomUUID(), type: 'match-choice', matchId, window, kind: 'night-action', choice: 4 });
  elapse(nightChoiceDuration);
  const witchCue = hearCue(nightCue).match.nightCue;
  assert.equal(witchCue.role, 'witch');
  hearCue(witchCue);

  const page = await playerPage(witch);
  await page.clock.install();
  await page.goto(url);
  const neutralPrompt = page.getByText('点击「显示操作」查看当前操作', { exact: true });
  const witchAction = page.getByRole('button', { name: '女巫请睁眼', exact: true });
  const target = page.getByText('狼刀目标：4号', { exact: true });
  const dialog = page.getByRole('dialog');
  await neutralPrompt.waitFor();
  assert.equal(await witchAction.count(), 0);
  assert.equal(await page.locator('[data-night-action-clock]').count(), 0);
  await showActions(page).click();
  await witchAction.click();
  await target.waitFor();

  await page.route(`**/api/rooms/${code}/sync`, route => route.abort(), { times: 1 });
  await page.getByText('正在重新连接…', { exact: true }).waitFor();
  await dialog.waitFor({ state: 'hidden' });
  await target.waitFor({ state: 'detached' });
  await page.getByText('正在重新连接…', { exact: true }).waitFor({ state: 'hidden' });
  await neutralPrompt.waitFor();
  assert.equal(await witchAction.count(), 0);
  assert.equal(await page.locator('dialog [data-form="match-choice"]').count(), 0);

  await showActions(page).click();
  await witchAction.click();
  await target.waitFor();

  // Freeze the interval after a successful sync so no request can fail while offline.
  await syncResponse(page, () => true);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 50)));
  await page.evaluate(() => {
    window.networkEvents = Object.fromEntries(['offline', 'online'].map(type => [type, new Promise(resolve => {
      window.addEventListener(type, () => resolve(navigator.onLine), { once: true });
    })]));
  });
  await page.context().setOffline(true);
  assert.equal(await page.evaluate(() => window.networkEvents.offline), false);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await showActions(page).isVisible(), true);
  const restored = syncResponse(page, () => true);
  await page.context().setOffline(false);
  assert.equal(await page.evaluate(() => window.networkEvents.online), true);
  await page.clock.resume();
  assert.equal((await restored).match.actions[0].action, 'witch');
  await target.waitFor({ state: 'detached' });
  assert.equal(await witchAction.count(), 0);

  await showActions(page).click();
  await witchAction.click();
  await target.waitFor();
  await dialog.getByRole('radio', { name: '使用解药', exact: true }).check();
  const accepted = page.waitForResponse(response => response.url().endsWith('/action'));
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  assert.equal((await accepted).status(), 200);
  await dialog.waitFor({ state: 'hidden' });
});

test('exile actions stay behind the disclosure and only the host can publish the ballot', { timeout: 30_000 }, async t => {
  const { code, host, players, rooms, playerPage, url } = await game(t, {
    lineup: ['villager', 'wolf', 'villager', 'villager'], sheriffMode: 'none',
    customRules: { victoryMode: 'town', firstNightKnife: 'disabled' },
  });
  function play({ token, guest }, kind, choice) {
    const { matchId, window } = rooms.sync(code, token, guest.tab).match;
    return rooms.action(code, token, guest.tab, { id: randomUUID(), type: 'match-choice', matchId, window, kind, choice }).room.match;
  }
  rooms.action(code, host.token, host.guest.tab, { id: randomUUID(), type: 'match-start' });
  play(players[1], 'night-action', 'confirm');
  let match = play(host, 'publish-night');
  while (match.phase === 'discussion') match = play(host, 'finish-speech');
  assert.equal(play(host, 'open-exile').phase, 'exile-vote');

  const page = await playerPage(players[2]);
  await page.goto(url);
  await showActions(page).waitFor();
  const abstain = page.getByRole('button', { name: '弃票', exact: true });
  const target = page.locator('.seat').nth(1);
  assert.equal(await abstain.count(), 0);
  assert.equal(await target.isDisabled(), true);
  await showActions(page).click();
  assert.equal(await target.isEnabled(), true);
  await target.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('投给 2号 · 玩家2？').waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '隐藏操作', exact: true }).click();
  assert.equal(await target.isDisabled(), true);
  assert.equal(await abstain.count(), 0);
  await showActions(page).click();
  await abstain.click();
  await dialog.getByText('确认弃票？').waitFor();
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await target.isDisabled(), true);
  assert.equal(await abstain.count(), 0);

  play(host, 'vote', 2);
  play(players[1], 'vote', 4);
  assert.equal(play(players[3], 'vote', null).phase, 'exile-vote');
  const reveal = page => page.getByRole('button', { name: '开票', exact: true });
  assert.equal(await reveal(page).count(), 0);

  const hostPage = await playerPage(host);
  await hostPage.goto(url);
  await showActions(hostPage).waitFor();
  assert.equal(await reveal(hostPage).count(), 0);
  await showActions(hostPage).click();
  await reveal(hostPage).click();
  await hostPage.getByText('放逐 PK 发言', { exact: true }).waitFor();
  await page.getByText('放逐 PK 发言', { exact: true }).waitFor();
  await page.getByText(/^PK：(?:2、4|4、2)号$/).waitFor();
});

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

test('an eligible player sees the timer continue through a disconnect and the dialog closes at expiry', { timeout: 30_000 }, async t => {
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
  await showActions(page).click();
  const control = page.locator('.night-action[data-action=match-control]');
  await control.click();
  const timer = page.locator('dialog [data-night-action-clock]');
  assert.equal(await timer.textContent(), '等待播报结束');
  ack();
  await timer.filter({ hasText: /^剩余 00:20$/ }).waitFor();
  elapse(8_000);
  rooms.disconnect(code, wolf.token, wolf.guest.tab);
  const synced = syncResponse(page, () => true);
  await page.evaluate(() => { window.actionTimerOffset += 8_000; });
  const { match } = await synced;
  const { deadline, serverNow } = match.actions[0].nightTimer;
  assert.equal(deadline - serverNow, 12_000);
  await timer.filter({ hasText: /^剩余 00:1[012]$/ }).waitFor();
  // Verify local expiry while the browser is still waiting for its next snapshot.
  await page.route(`**/api/rooms/${code}/sync`, () => {});
  await page.evaluate(() => { window.actionTimerOffset += 12_000; });
  await page.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal(await control.isDisabled(), true);
});

test('resuming with an expired response does not reopen the private action', { timeout: 30_000 }, async t => {
  const { code, host, guard, rooms, elapse, playerPage, url } = await game(t);
  const { room: { match: { nightCue } } } = rooms.action(code, host.token, host.guest.tab, {
    id: randomUUID(), type: 'match-start', nightNarration: true,
  });
  rooms.sync(code, host.token, host.guest.tab, { seenNightCue: nightCue, nightCuePlaybackComplete: true });
  elapse(nightChoiceDuration - 2_000);
  const page = await playerPage(guard);
  await page.route(`**/api/rooms/${code}/resume`, async route => {
    const response = await route.fetch();
    const { deadline, serverNow } = (await response.json()).match.actions[0].nightTimer;
    assert.equal(deadline - serverNow, 2_000);
    elapse(2_200);
    await new Promise(resolve => setTimeout(resolve, 2_200));
    await route.fulfill({ response });
  }, { times: 1 });
  await page.goto(url);
  await showActions(page).click();
  const control = page.locator('.night-action[data-action=match-control]');
  await control.waitFor();
  assert.equal(await control.isDisabled(), true);
  assert.equal(await page.locator('[data-night-action-clock]').textContent(), '操作时间已到');
});

test('a fresh poll restores an action after a slow outgoing reconnect request', { timeout: 30_000 }, async t => {
  const { code, host, guard, players, rooms, elapse, playerPage, url } = await game(t);
  const { room: { match: { nightCue } } } = rooms.action(code, host.token, host.guest.tab, {
    id: randomUUID(), type: 'match-start', nightNarration: true,
  });
  rooms.sync(code, host.token, host.guest.tab, { seenNightCue: nightCue, nightCuePlaybackComplete: true });
  elapse(nightChoiceDuration - 10_000);
  const page = await playerPage(guard);
  await page.route(`**/api/rooms/${code}/resume`, async route => {
    elapse(5_500, players.filter(player => player !== guard));
    await page.evaluate(() => {
      const now = performance.now.bind(performance);
      Object.defineProperty(performance, 'now', { value: () => now() + 5_500 });
    });
    await route.continue();
  }, { times: 1 });
  await page.route(`**/api/rooms/${code}/sync`, async route => {
    elapse(1_800);
    await route.continue();
  }, { times: 1 });
  await page.goto(url);
  await showActions(page).click();
  const control = page.locator('.night-action[data-action=match-control]');
  const timer = page.locator('[data-night-action-clock]');
  await timer.filter({ hasText: '操作时间已到' }).waitFor();
  assert.equal(await control.isDisabled(), true);

  await control.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: '跳过', exact: true }).check();
  const accepted = page.waitForResponse(response => response.url().endsWith('/action'));
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  assert.equal((await accepted).status(), 200);
});

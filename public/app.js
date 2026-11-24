import { boards, roles, thiefDraw } from './boards.js';

const root = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const notice = document.querySelector('#notice');
const homeLink = document.querySelector('#home-link');
const tab = crypto.randomUUID();
const codePattern = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const credentialKey = code => `werewolf-room-${code}`;
const pendingJoinKey = code => `werewolf-pending-${code}`;
const recentKey = 'werewolf-recent';
const pendingCreateKey = 'werewolf-create';
const headers = { 'Content-Type': 'application/json' };
const memoryStorage = new Map();

let screen = 'home';
let board = 'mechanical';
let code;
let lobby;
let info;
let credential;
let waiting = false;
let connected = false;
let takenOver = false;
let resumable = false;
let reconnectDelay = 1_000;
let pollTimer;
let pollInFlight;
let epoch = 0;
let sequence = 0;
let retryAction;
let noticeTimer;
let roomError = '';

function read(key) {
  try { return localStorage.getItem(key) ?? memoryStorage.get(key); }
  catch { return memoryStorage.get(key); }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    if (value === null) memoryStorage.delete(key);
    else memoryStorage.set(key, value);
  }
}

function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function message(text) {
  clearTimeout(noticeTimer);
  notice.textContent = text;
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4_000);
}

function button(label, action, options = {}) {
  const { variant = 'primary', disabled = false, value } = options;
  return `<button type="button" class="button ${variant}" data-action="${action}"${value === undefined ? '' : ` data-value="${escape(value)}"`}${disabled ? ' disabled' : ''}>${escape(label)}</button>`;
}

function roleMark(roleId) {
  const art = roles[roleId].art ?? roleId;
  return `<img class="mark" src="/art/${art}.png" alt="" width="75" height="75">`;
}

function roleTile(roleId) {
  if (roleId === null) {
    return '<div class="role-tile"><span class="mark random" aria-hidden="true">?</span><span>随机神牌</span></div>';
  }
  return `<div class="role-tile">${roleMark(roleId)}<span>${roles[roleId].name}</span></div>`;
}

function boardPreview(boardId, showName = false) {
  const selected = boards[boardId];
  return `<div class="board-preview">
    ${showName ? `<h3 class="board-name">${selected.name}</h3>` : ''}
    <p class="player-count">总玩家数：<strong>12人</strong></p>
    <div class="role-grid">${selected.preview.map(roleTile).join('')}</div>
    ${boardId === 'thief' ? `<p class="draw-note">盗宝神牌随机抽取一张 · ${thiefDraw.map(id => roles[id].name).join('、')}</p>` : ''}
  </div>`;
}

function nicknameForm(action, label) {
  return `<form data-form="${action}" class="stack">
    <label for="nickname">你的昵称</label>
    <input id="nickname" name="nickname" autocomplete="nickname" maxlength="40" required placeholder="输入昵称">
    <button class="button primary" type="submit">${label}</button>
  </form>`;
}

function home() {
  return `<div class="home">
    <h1 class="screen-reader-only">米多狼人面杀助手</h1>
    <img class="hero" src="/art/home.png" width="590" height="392" alt="">
    <div class="stack home-actions">
      ${button('创建房间', 'create-screen')}
      ${button('加入房间', 'join-screen')}
      ${button('回到最近一局', 'recent', { variant: 'secondary' })}
    </div>
    <div class="home-help">${button('用法简介', 'help', { variant: 'quiet' })}</div>
  </div>`;
}

function createScreen() {
  return `<h1>快速配置</h1>
    <div class="presets" aria-label="选择板子">
      ${Object.entries(boards).map(([id, item]) => `<button type="button" class="preset" data-action="preset" data-value="${id}" aria-pressed="${id === board}">${item.name}</button>`).join('')}
    </div>
    ${boardPreview(board)}
    <div class="setup-actions">${button('确认创建', 'create-details', { variant: 'secondary' })}</div>`;
}

function joinScreen() {
  return `<h1>加入房间</h1><form data-form="join-code" class="stack">
    <label for="room-code">房间号</label>
    <input id="room-code" class="code-input" name="code" autocapitalize="characters" autocomplete="off" maxlength="6" minlength="6" required placeholder="6 位房间号">
    <button class="button primary" type="submit">进入房间</button>
  </form>`;
}

const phases = { lobby: '准备中', dealt: '确认身份中', ready: '身份确认完成' };

function seatTile(guest, index) {
  const seat = index + 1;
  const mine = guest?.id === lobby.self.id;
  const playable = lobby.state === 'lobby' && connected && (!guest || mine);
  const name = guest?.name ?? '空座位';
  const label = mine && playable ? '点击起立' : name;
  const sub = !guest ? '空座位' : !guest.connected ? '离线' : guest.acknowledged ? '已准备' : '已坐下';
  return `<button type="button" class="seat${mine ? ' mine' : ''}${guest ? '' : ' vacant'}" data-action="seat" data-value="${seat}" aria-label="${seat}号座，${escape(label)}" ${playable ? '' : 'disabled'}>
    <span class="seat-top">${guest ? `<span class="seat-avatar" aria-hidden="true">${escape(Array.from(name)[0])}</span>` : '<img class="seat-avatar" src="/art/empty-seat.png" width="55" height="55" alt="">'}${guest?.host ? '<span class="host-label">房主</span>' : ''}</span>
    <strong class="seat-name"><span class="seat-number">${seat}</span>:${escape(guest ? name : '等待')}</strong>
    <span class="seat-state${guest?.connected ? ' present' : ''}"><span aria-hidden="true">${guest?.connected ? '✓' : 'ⓘ'}</span> ${sub}</span>
  </button>`;
}

function roomScreen() {
  if (roomError) return `<h1>房间 ${code}</h1><p class="panel">${escape(roomError)}</p>${button('返回首页', 'home', { variant: 'secondary' })}`;
  if (!lobby) {
    if (!info) return `<h1>房间 ${code}</h1><p role="status">正在连接…</p>`;
    if (info.full || info.state !== 'lobby') {
      return `<h1>房间 ${code}</h1><p class="panel">房间已满。</p>${button('返回首页', 'home', { variant: 'secondary' })}`;
    }
    return `<h1>房间 ${code}</h1><p class="board-name">${boards[info.board].name}</p>${nicknameForm('join-room', '加入房间')}`;
  }
  const { self, seats, state } = lobby;
  const seatedCount = seats.filter(Boolean).length;
  const acknowledgements = seats.filter(guest => guest?.acknowledged).length;
  const boardName = boards[lobby.board].name;
  const phaseSummary = state === 'lobby' ? `${seatedCount} / 12 已入座` : `${acknowledgements} / 12 已确认`;
  const phaseInstruction = state === 'lobby' ? '点击空座位坐下，点击自己可站起来'
    : state === 'ready' ? '全部身份已确认' : '请查看并确认身份';
  return `<h1 class="screen-reader-only">${boardName}</h1>
    <div class="room-tools">
      ${button('用法简介', 'help', { variant: 'quiet' })}
      ${self.host && state === 'lobby' ? button('房主操作', 'manage', { variant: 'quiet', disabled: !connected }) : ''}
      ${button('本局配置', 'config', { variant: 'quiet' })}
    </div>
    <section class="room-overview">
      <img class="room-art" src="/art/room.png" width="225" height="241" alt="">
      <div class="room-meta">
        <div><span class="meta-label">房间编号：</span><strong class="room-code">${code}</strong></div>
        <div><span class="meta-label">房间状态：</span><strong>${phases[state]}</strong></div>
        <div><span class="meta-label">我的座位：</span><strong>${self.seat ?? '未入座'}</strong></div>
        ${button('查看我的身份', 'reveal', { variant: 'secondary', disabled: !connected || state === 'lobby' })}
      </div>
    </section>
    <div class="stack room-actions">
      ${button('邀请好友', 'invite')}
      ${state === 'lobby' && self.host ? button('发放身份', 'confirm-deal', { disabled: !connected || !lobby.canDeal }) : ''}
    </div>
    ${takenOver ? `<div class="connection" role="status">另一个页面正在使用此座位。${button('在此页继续', 'take-control', { variant: 'secondary' })}</div>` : ''}
    ${!connected && !takenOver ? '<p class="connection" role="status">正在重新连接…</p>' : ''}
    <div class="phase-panel"><strong>${phaseInstruction}</strong><span>${phaseSummary}</span></div>
    <section class="seats" aria-label="12 个座位">${seats.map(seatTile).join('')}</section>
    ${lobby.waiting.length ? `<p class="waiting">未入座 · ${lobby.waiting.map(guest => escape(guest.name)).join('、')}</p>` : ''}`;
}

function render() {
  const contents = { home, create: createScreen, join: joinScreen, room: roomScreen };
  root.dataset.screen = screen;
  homeLink.hidden = screen === 'home';
  root.innerHTML = contents[screen]();
}

function showDialog(title, body, appearance = '') {
  dialog.className = appearance;
  dialog.innerHTML = `<div class="dialog-title"><h2 id="dialog-title">${escape(title)}</h2>${appearance === 'identity-dialog' ? '' : button('关闭', 'close', { variant: 'quiet' })}</div>${body}`;
  if (!dialog.open) dialog.showModal();
}

function confirm(title, body, action, label, value) {
  showDialog(title, `<p>${escape(body)}</p><div class="dialog-actions">${button('取消', 'close', { variant: 'secondary' })}${button(label, action, { value })}</div>`);
}

async function request(path, body, token, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      ...options,
    });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.message), { code: value.code });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function endpoint(operation) {
  return `/api/rooms/${code}${operation ? `/${operation}` : ''}`;
}

function roomRequest(operation, body = {}, options = {}) {
  return request(endpoint(operation), { ...body, tab }, credential, options);
}

function applyLobby(next) {
  const changed = !connected || JSON.stringify(next) !== JSON.stringify(lobby);
  lobby = next;
  connected = true;
  takenOver = false;
  resumable = true;
  reconnectDelay = 1_000;
  write(credentialKey(code), credential);
  write(pendingJoinKey(code), null);
  write(recentKey, code);
  if (changed) render();
}

function handleRoomError(error) {
  if (error.code === 'TAKEN_OVER') {
    takenOver = true;
    connected = false;
    dialog.close();
    render();
    return;
  }
  if (['SESSION_ENDED', 'ROOM_GONE', 'CREDENTIAL'].includes(error.code)) {
    write(credentialKey(code), null);
    write(pendingJoinKey(code), null);
    if (read(recentKey) === code) write(recentKey, null);
    credential = null;
    lobby = null;
    connected = false;
    roomError = error.message;
    dialog.close();
    render();
    return;
  }
  if (connected) {
    connected = false;
    render();
  }
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  if (screen === 'room' && credential && !takenOver) pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (pollInFlight === epoch || waiting || !credential) {
    schedulePoll(350);
    return;
  }
  const period = epoch;
  const version = sequence;
  pollInFlight = period;
  try {
    const next = await roomRequest(resumable ? 'sync' : 'resume');
    if (period === epoch && version === sequence) applyLobby(next);
  } catch (error) {
    if (period === epoch && version === sequence) {
      handleRoomError(error);
      reconnectDelay = Math.min(reconnectDelay * 2, 8_000);
    }
  } finally {
    if (pollInFlight === period) pollInFlight = undefined;
    if (period === epoch) schedulePoll(connected ? 1_800 : reconnectDelay);
  }
}

function leaveConnection() {
  if (screen === 'room' && credential && resumable && !takenOver) {
    roomRequest('disconnect', {}, { keepalive: true }).catch(() => {});
  }
}

async function go(path, replace = false) {
  if (screen === 'room' && path.replace(/\/$/, '') !== `/room/${code}`) leaveConnection();
  clearTimeout(pollTimer);
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  const period = ++epoch;
  sequence++;
  dialog.close();
  lobby = null;
  info = null;
  retryAction = undefined;
  roomError = '';
  credential = null;
  connected = false;
  resumable = false;
  takenOver = false;
  waiting = false;
  const match = /^\/room\/([A-Z0-9]{6})\/?$/.exec(path);
  if (match && codePattern.test(match[1])) {
    screen = 'room';
    code = match[1];
    credential = read(credentialKey(code));
  } else {
    screen = path === '/create' ? 'create' : path === '/join' ? 'join' : 'home';
  }
  render();
  if (screen !== 'room') return;
  if (credential) {
    poll();
    return;
  }
  const pending = read(pendingJoinKey(code));
  if (pending) {
    try {
      const next = await request(endpoint('resume'), { tab }, pending);
      if (period !== epoch) return;
      credential = pending;
      applyLobby(next);
      schedulePoll(1_800);
      return;
    } catch (error) {
      if (period !== epoch) return;
      if (error.code) write(pendingJoinKey(code), null);
    }
  }
  try {
    const result = await request(endpoint());
    if (period !== epoch) return;
    info = result;
  } catch (error) {
    if (period !== epoch) return;
    roomError = error.code ? error.message : '连接失败，请重新打开房间链接。';
  }
  render();
}

async function submit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  if (waiting) return;
  const data = new FormData(form);
  if (form.dataset.form === 'join-code') {
    const value = data.get('code').trim().toUpperCase();
    if (!codePattern.test(value)) return message('请输入有效的房间号。');
    go(`/room/${value}`);
    return;
  }
  const name = data.get('nickname');
  const period = epoch;
  waiting = true;
  const submitButton = event.submitter ?? form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    if (form.dataset.form === 'create') {
      const token = read(pendingCreateKey) ?? newToken();
      write(pendingCreateKey, token);
      const result = await request('/api/rooms', { name, board, tab }, token);
      write(pendingCreateKey, null);
      write(credentialKey(result.code), token);
      if (period === epoch) go(`/room/${result.code}`);
    } else {
      credential ??= read(pendingJoinKey(code)) ?? newToken();
      write(pendingJoinKey(code), credential);
      const next = await roomRequest('join', { name });
      if (period === epoch) {
        applyLobby(next);
        schedulePoll(1_800);
      }
    }
  } catch (error) {
    if (period === epoch) {
      if (error.code === 'SESSION_ENDED' && screen === 'room') {
        credential = null;
        write(pendingJoinKey(code), null);
      }
      message(error.code ? error.message : '连接失败，请重试。');
    }
  } finally {
    if (period === epoch) {
      waiting = false;
      submitButton.disabled = false;
    }
  }
}

async function action(type, details = {}) {
  if (waiting || !connected) return;
  const period = epoch;
  const signature = JSON.stringify([type, details]);
  const id = retryAction?.signature === signature ? retryAction.id : crypto.randomUUID();
  retryAction = { signature, id };
  waiting = true;
  sequence++;
  try {
    const result = await roomRequest('action', { command: { id, type, ...details } });
    if (period !== epoch) return;
    retryAction = undefined;
    applyLobby(result.room);
    if (type === 'reveal') {
      const { role, extra } = result.assignment;
      showDialog('我的身份', `<div class="identity"><div class="identity-detail">${roleMark(role)}<h3>${roles[role].name}</h3><p>${roles[role].description}</p>
        ${extra ? `<h4 class="meta-label">你的额外牌</h4><div class="extra-cards">${extra.map(roleTile).join('')}</div>` : ''}</div>
        ${button('我知道了', lobby.self.acknowledged ? 'close' : 'acknowledge', { variant: 'identity-accept' })}</div>`, 'identity-dialog');
    } else dialog.close();
  } catch (error) {
    if (period !== epoch) return;
    if (error.code) {
      retryAction = undefined;
      if (['TAKEN_OVER', 'SESSION_ENDED', 'ROOM_GONE'].includes(error.code)) handleRoomError(error);
    } else handleRoomError(error);
    message(error.code ? error.message : '连接中断，请重试。');
  } finally {
    if (period === epoch) {
      waiting = false;
      schedulePoll(connected ? 300 : 1_000);
    }
  }
}

function inviteUrl() {
  return new URL(`/room/${code}`, location.origin).href;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    message('房间链接已复制。');
  } catch {
    const input = dialog.querySelector('input');
    input.focus();
    input.select();
    message('请复制选中的链接。');
  }
}

async function click(event) {
  const link = event.target.closest('[data-go]');
  if (link) {
    event.preventDefault();
    go(link.pathname);
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const { action: command, value } = control.dataset;
  switch (command) {
    case 'home': return go('/');
    case 'create-screen': return go('/create');
    case 'join-screen': return go('/join');
    case 'recent': {
      const recent = read(recentKey);
      if (codePattern.test(recent ?? '')) return go(`/room/${recent}`);
      return message('还没有最近的房间。');
    }
    case 'preset': {
      board = value;
      render();
      root.querySelector(`[data-value="${value}"]`).focus();
      return;
    }
    case 'create-details':
      return showDialog('创建房间', nicknameForm('create', '确认创建'));
    case 'help':
      return showDialog('用法简介', '<ol class="help-steps"><li>房主选择板子并邀请好友。</li><li>点击空座位入座。</li><li>房主在 12 位玩家入座后发放身份。</li><li>查看自己的身份并点击「我知道了」。</li></ol>');
    case 'invite':
      return showDialog('邀请好友', `<label for="invite-link">房间链接</label><input id="invite-link" value="${escape(inviteUrl())}" readonly>
        <div class="dialog-actions">${button('复制链接', 'copy-invite')}${navigator.share ? button('分享链接', 'share-invite', { variant: 'secondary' }) : ''}</div>`);
    case 'copy-invite': return copyInvite();
    case 'share-invite':
      try { await navigator.share({ title: '狼人杀 · 邀请好友', url: inviteUrl() }); }
      catch (error) { if (error.name !== 'AbortError') await copyInvite(); }
      return;
    case 'config': return showDialog('本局配置', boardPreview(lobby.board, true));
    case 'seat':
      return Number(value) === lobby.self.seat ? action('stand') : action('seat', { seat: Number(value) });
    case 'confirm-deal':
      return confirm('发放身份', '发放后座位锁定，每位玩家只可查看自己的身份。', 'deal', '确认发放');
    case 'deal': return action('deal');
    case 'reveal': return action('reveal');
    case 'acknowledge': return action('acknowledge');
    case 'manage': {
      const guests = [...lobby.seats.filter(Boolean), ...lobby.waiting].filter(guest => !guest.host);
      const list = guests.map(guest => `<li><span>${escape(guest.name)}${guest.seat ? ` · ${guest.seat}号` : ' · 未入座'}</span>${button('移除', 'confirm-remove', { variant: 'secondary', value: guest.id })}</li>`).join('');
      return showDialog('房主操作', list ? `<ul class="guest-list">${list}</ul>` : '<p>目前没有其他玩家。</p>');
    }
    case 'confirm-remove': {
      const guest = [...lobby.seats.filter(Boolean), ...lobby.waiting].find(item => item.id === value);
      return guest ? confirm('移除玩家', `将 ${guest.name} 移出房间？`, 'remove', '确认移除', value) : dialog.close();
    }
    case 'remove': return action('remove', { target: value });
    case 'take-control':
      resumable = false;
      takenOver = false;
      render();
      return poll();
    case 'close': return dialog.close();
  }
}

document.addEventListener('submit', submit);
document.addEventListener('click', click);
dialog.addEventListener('close', () => { if (!dialog.open) dialog.replaceChildren(); });
window.addEventListener('popstate', () => go(location.pathname, true));
window.addEventListener('online', () => schedulePoll(0));
window.addEventListener('pagehide', leaveConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePoll(0); });
go(location.pathname, true);

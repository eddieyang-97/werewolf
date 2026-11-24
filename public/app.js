import {
  boards, customBoardName, customLineupError, customRoleGroups, customRoles, defaultSheriffMode, nightSchedules,
  presetSeatCount, repeatableRole, roles, sheriffModes, thiefDraw,
} from './boards.js';
import { choiceLabel, matchHistory, matchLabel, matchPanel, timerText, voteDetail } from './match.js';

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
const maxAvatarFileSize = 20 * 1024 * 1024;
const maxAvatarLength = 16_384;
const avatarSize = 128;
const jpegPrefix = 'data:image/jpeg;base64,';

let screen = 'home';
let board = 'mechanical';
const customLineup = [];
let customTab = 'wolves';
let customQuery = '';
let customSheriffMode = defaultSheriffMode;
let code;
let lobby;
let info;
let joinDraft;
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
let matchClock;
let roomError = '';
let showingHistory = false;

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
  if (roleId === 'wolfKing') {
    return `<span class="mark wolf-king-mark" aria-hidden="true"><img src="/art/${art}.png" alt=""><span>王</span></span>`;
  }
  return `<img class="mark" src="/art/${art}.png" alt="" width="75" height="75">`;
}

function roleTile(roleId) {
  if (roleId === null) {
    return '<div class="role-tile"><span class="mark random" aria-hidden="true">?</span><span>随机神牌</span></div>';
  }
  return `<div class="role-tile">${roleMark(roleId)}<span>${roles[roleId].name}</span></div>`;
}

function boardDetails(boardId, lineup) {
  return boardId === 'custom' ? { name: customBoardName, preview: lineup } : boards[boardId];
}

function boardPreview(boardId, lineup, showName = false) {
  const selected = boardDetails(boardId, lineup);
  return `<div class="board-preview">
    ${showName ? `<h3 class="board-name">${selected.name}</h3>` : ''}
    <p class="player-count" aria-live="polite">总玩家数：<strong>${selected.preview.length}人</strong></p>
    ${selected.preview.length ? `<div class="role-grid">${selected.preview.map(roleTile).join('')}</div>` : ''}
    ${boardId === 'thief' ? `<p class="draw-note">盗宝神牌随机抽取一张 · ${thiefDraw.map(id => roles[id].name).join('、')}</p>` : ''}
  </div>`;
}

function avatarField(avatar) {
  return `<div class="avatar-field">
    <label id="avatar-label" for="avatar-file">头像（选填）</label>
    <img class="avatar-preview seat-avatar" alt="" ${avatar ? `src="${escape(avatar)}"` : 'hidden'}>
    <input id="avatar-file" class="avatar-file screen-reader-only" type="file" name="avatar" accept="image/*" aria-labelledby="avatar-label" aria-describedby="avatar-status">
    <label class="button secondary avatar-picker" for="avatar-file">选择照片</label>
    <button class="button quiet avatar-clear" type="button" data-action="clear-avatar" ${avatar ? '' : 'hidden'}>移除头像</button>
    <p id="avatar-status" class="avatar-status" role="status"></p>
  </div>`;
}

function profileForm(action, label, guest, draft) {
  const { name, avatar } = guest ? {} : draft ?? { name: '' };
  const preview = guest ? guest.avatar : avatar && `${jpegPrefix}${avatar}`;
  return `<form data-form="${action}" class="stack"${avatar ? ` data-avatar="${escape(avatar)}"` : ''}>
    ${guest ? '' : `<label for="nickname">你的昵称</label><input id="nickname" name="nickname" autocomplete="nickname" maxlength="40" required placeholder="输入昵称" value="${escape(name)}">`}
    ${avatarField(preview)}
    <button class="button primary" type="submit">${label}</button>
  </form>`;
}

function home() {
  return `<div class="home">
    <h1 class="screen-reader-only">狼人面杀助手</h1>
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
    <div class="stack setup-actions">
      ${button('确认创建', 'create-details', { variant: 'secondary' })}
      ${button(customBoardName, 'custom-screen', { variant: 'secondary' })}
    </div>`;
}

const customTabs = { wolves: '狼人阵营', village: '好人阵营', other: '其他阵营', settings: '房间配置' };

function customOptions() {
  if (customTab === 'settings' && !customQuery) {
    const fixedSettings = { 明牌暗牌: '暗牌', 首夜狼刀: '首夜有刀', 女巫自救: '不能自救', 观战设置: '满座后可观战' };
    return `<div class="custom-settings">
      <div class="custom-setting"><span>获胜条件</span><span class="setting-value">屠边</span></div>
      <button type="button" class="custom-setting custom-sheriff-row" data-action="sheriff-settings" aria-haspopup="dialog">
        <span>警徽设置</span><span class="setting-value"><span id="sheriff-setting-value">${sheriffModes[customSheriffMode]}</span><span aria-hidden="true">›</span></span>
      </button>
      ${Object.entries(fixedSettings).map(([name, value]) => `<div class="custom-setting"><span>${name}</span><span class="setting-value">${value}</span></div>`).join('')}
    </div>`;
  }
  const ids = customQuery ? customRoles.filter(id => roles[id].name.includes(customQuery)) : customRoleGroups[customTab];
  if (!ids.length) return '<p class="custom-empty" role="status">没有找到匹配的角色。</p>';
  return `<div class="custom-role-grid">${ids.map(id => {
    const name = roles[id].name;
    const count = customLineup.filter(role => role === id).length;
    const repeatable = repeatableRole(id);
    const active = count > 0;
    const label = repeatable ? `添加${name}（已选${count}张）` : name;
    const disabled = customLineup.length >= presetSeatCount && (repeatable || !active);
    return `<div class="role-choice${active ? ' selected' : ''}">
      <button type="button" class="role-pick" data-action="custom-role" data-value="${id}" aria-label="${label}"${repeatable ? '' : ` aria-pressed="${active}"`}${disabled ? ' disabled' : ''}>${name}${repeatable && active ? ` ×${count}` : ''}</button>
      ${repeatable && active ? `<button type="button" class="role-decrease" data-action="custom-remove" data-value="${id}" aria-label="减少${name}">−</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function customPreview() {
  const error = customLineupError(customLineup);
  return `${boardPreview('custom', customLineup)}
    ${error ? `<p class="custom-hint" role="status">${error}</p>` : ''}
    <div class="setup-actions">${button('确认创建', 'create-details', { variant: 'secondary', disabled: Boolean(error) })}</div>`;
}

function customScreen() {
  return `<h1>${customBoardName}</h1>
    <input class="custom-search" type="search" aria-label="搜索角色名称" data-custom-search placeholder="搜索角色名称" value="${escape(customQuery)}">
    <nav class="custom-tabs" aria-label="配置分类">${Object.entries(customTabs).map(([id, name]) =>
      `<button type="button" data-action="custom-tab" data-value="${id}" aria-pressed="${id === customTab}">${name}</button>`).join('')}</nav>
    <div class="custom-options">${customOptions()}</div>
    <div class="custom-preview">${customPreview()}</div>`;
}

function joinScreen() {
  return `<h1>加入房间</h1><form data-form="join-code" class="stack">
    <label for="room-code">房间号</label>
    <input id="room-code" class="code-input" name="code" autocapitalize="characters" autocomplete="off" maxlength="6" minlength="6" required placeholder="6 位房间号">
    <button class="button primary" type="submit">进入房间</button>
  </form>`;
}

const phases = { lobby: '准备中', dealt: '确认身份中', ready: '身份确认完成', playing: '游戏中', finished: '对局结束' };

function seatTile(guest, index) {
  const seat = index + 1;
  const mine = guest?.id === lobby.self.id;
  const playable = !lobby.self.spectator && lobby.state === 'lobby' && connected && (!guest || mine);
  const canReplace = connected && lobby.self.canRequestReplacement && guest && !guest.connected && !guest.host
    && lobby.self.replacementSeat !== seat;
  const name = guest?.name ?? '空座位';
  const label = canReplace ? `申请替补 ${name}` : mine && playable ? '点击起立' : name;
  const out = lobby.match?.departed.includes(seat);
  const sub = canReplace ? '离线 · 申请替补' : !guest ? '空座位' : out ? '已出局' : !guest.connected ? '离线' : lobby.match ? '在场' : guest.acknowledged ? '已准备' : '已坐下';
  const image = guest?.avatar ?? (guest ? null : '/art/empty-seat.png');
  const avatar = image ? `<img class="seat-avatar" src="${escape(image)}" width="36" height="36" alt="">`
    : `<span class="seat-avatar" aria-hidden="true">${escape(Array.from(name)[0])}</span>`;
  return `<button type="button" class="seat${mine ? ' mine' : ''}${guest ? '' : ' vacant'}" data-action="${canReplace ? 'confirm-replacement' : 'seat'}" data-value="${canReplace ? guest.id : seat}" aria-label="${seat}号座，${escape(label)}" ${playable || canReplace ? '' : 'disabled'}>
    <span class="seat-top">${avatar}${guest?.host ? '<span class="host-label">房主</span>' : ''}${lobby.match?.sheriff === seat ? '<span class="sheriff-label">警长</span>' : ''}</span>
    <strong class="seat-name"><span class="seat-number">${seat}</span>:${escape(guest ? name : '等待')}</strong>
    <span class="seat-state${out ? ' eliminated' : guest?.connected ? ' present' : ''}"><span aria-hidden="true">${guest?.connected && !out ? '✓' : 'ⓘ'}</span> ${sub}</span>
  </button>`;
}

function roomScreen() {
  if (roomError) return `<h1>房间 ${code}</h1><p class="panel">${escape(roomError)}</p>${button('返回首页', 'home', { variant: 'secondary' })}`;
  if (!lobby) {
    if (!info) return `<h1>房间 ${code}</h1><p role="status">正在连接…</p>`;
    const boardName = boardDetails(info.board, info.lineup).name;
    if (info.full) return `<h1>房间 ${code}</h1><p class="board-name">${boardName}</p>
      <p class="panel">座位已满，可以观战。</p>${profileForm('spectate-room', '观战', null, joinDraft)}`;
    return `<h1>房间 ${code}</h1><p class="board-name">${boardName}</p>${profileForm('join-room', '加入房间', null, joinDraft)}`;
  }
  const { self, seats, state } = lobby;
  const seatedCount = seats.filter(Boolean).length;
  const acknowledgements = seats.filter(guest => guest?.acknowledged).length;
  const boardName = boardDetails(lobby.board, lobby.lineup).name;
  const phaseSummary = state === 'lobby' ? `${seatedCount} / ${seats.length} 已入座` : `${acknowledgements} / ${seats.length} 已确认`;
  const phaseInstruction = state === 'lobby' ? '点击空座位坐下，点击自己可站起来'
    : state === 'ready' ? '全部身份已确认' : '请查看并确认身份';
  const requests = lobby.replacementRequests?.length;
  const replacementStatus = self.replacementSeat
    ? `已申请替补 ${self.replacementSeat} 号座，等待房主同意。${button('撤回申请', 'replacement-cancel', { variant: 'quiet', disabled: !connected })}`
    : self.canRequestReplacement ? '可以点击离线座位申请替补。' : '当前为观战模式。';
  return `<h1 class="screen-reader-only">${boardName}</h1>
    <div class="room-tools">
      ${button('用法简介', 'help', { variant: 'quiet' })}
      ${self.spectator ? '' : button('编辑资料', 'profile', { variant: 'quiet', disabled: !connected })}
      ${self.host && (state === 'lobby' || lobby.match?.canAbandon) ? button('房主操作', 'manage', { variant: 'quiet', disabled: !connected }) : ''}
      ${button('本局配置', 'config', { variant: 'quiet' })}
    </div>
    <section class="room-overview">
      <img class="room-art" src="/art/room.png" width="225" height="241" alt="">
      <div class="room-meta">
        <div><span class="meta-label">房间编号：</span><strong class="room-code">${code}</strong></div>
        <div><span class="meta-label">房间状态：</span><strong>${phases[state]}</strong></div>
        <div><span class="meta-label">我的座位：</span><strong>${self.spectator ? '观战中' : self.seat ?? '未入座'}</strong></div>
        ${self.spectator ? '' : button('查看我的身份', 'reveal', { variant: 'secondary', disabled: !connected || state === 'lobby' })}
      </div>
    </section>
    <div class="stack room-actions">
      ${button('邀请好友', 'invite')}
      ${state === 'lobby' && self.host ? button('发放身份', 'confirm-deal', { disabled: !connected || !lobby.canDeal }) : ''}
      ${state === 'ready' && Object.hasOwn(lobby, 'canStart') ? button('开始游戏', 'confirm-start', { disabled: !connected || !lobby.canStart }) : ''}
      ${requests ? button(`替补申请（${requests}）`, 'replacement-requests', { variant: 'secondary', disabled: !connected }) : ''}
    </div>
    ${takenOver ? `<div class="connection" role="status">另一个页面正在使用此房间会话。${button('在此页继续', 'take-control', { variant: 'secondary' })}</div>` : ''}
    ${!connected && !takenOver ? '<p class="connection" role="status">正在重新连接…</p>' : ''}
    ${self.spectator ? `<div class="phase-panel" role="status">${replacementStatus}</div>` : ''}
    ${lobby.match ? matchPanel(lobby.match, button, connected) : `<div class="phase-panel">${self.spectator ? '' : `<strong>${phaseInstruction}</strong>`}<span>${phaseSummary}</span></div>`}
    <section class="seats" aria-label="${seats.length} 个座位">${seats.map(seatTile).join('')}</section>
    ${lobby.waiting.length ? `<p class="waiting">未入座 · ${lobby.waiting.map(guest => escape(guest.name)).join('、')}</p>` : ''}
    ${lobby.spectatorCount ? `<p class="waiting">观战 · ${lobby.spectatorCount} 人</p>` : ''}`;
}

function render() {
  const contents = { home, create: createScreen, custom: customScreen, join: joinScreen, room: roomScreen };
  const historyOpen = screen === 'room' && showingHistory && lobby?.match;
  root.dataset.screen = historyOpen ? 'match-history' : screen;
  homeLink.hidden = screen === 'home';
  homeLink.href = screen === 'custom' ? '/create' : '/';
  homeLink.setAttribute('aria-label', historyOpen ? '返回对局' : screen === 'custom' ? '返回快速配置' : '返回首页');
  root.innerHTML = historyOpen ? matchHistory(lobby.match.history, button) : contents[screen]();
  clearInterval(matchClock);
  const timer = root.querySelector('[data-match-deadline]');
  if (timer) {
    matchClock = setInterval(() => {
      const remaining = Number(timer.dataset.matchDeadline) - Date.now();
      const text = timerText(remaining);
      if (timer.textContent !== text) timer.textContent = text;
      if (remaining <= 0) clearInterval(matchClock);
    }, 250);
  }
}

function showDialog(title, body, appearance = '') {
  dialog.className = appearance;
  const hasFooter = ['identity-dialog', 'ballot-dialog', 'sheriff-dialog'].includes(appearance);
  dialog.innerHTML = `<div class="dialog-title"><h2 id="dialog-title">${escape(title)}</h2>${hasFooter ? '' : button('关闭', 'close', { variant: 'quiet' })}</div>${body}`;
  if (!dialog.open) dialog.showModal();
}

function showSheriffSettings() {
  const options = Object.entries(sheriffModes).map(([mode, name]) => `<label class="sheriff-option">
    <input type="radio" name="sheriffMode" value="${mode}"${mode === customSheriffMode ? ' checked autofocus' : ''}>
    ${mode === 'none' ? name : `有警徽，${name}`}
  </label>`).join('');
  showDialog('警徽设置', `<form data-form="sheriff-settings">
    <fieldset class="sheriff-options" aria-labelledby="dialog-title">${options}</fieldset>
    <div class="dialog-actions">${button('取消', 'close', { variant: 'secondary' })}<button class="button primary" type="submit">确定</button></div>
  </form>`, 'sheriff-dialog');
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
  if (lobby && next.self.spectator !== lobby.self.spectator) {
    dialog.close();
    message(next.self.spectator ? '座位已由替补接手，你已进入观战。' : `你已替补进入 ${next.self.seat} 号座。`);
  }
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
  joinDraft = null;
  retryAction = undefined;
  roomError = '';
  credential = null;
  connected = false;
  resumable = false;
  takenOver = false;
  showingHistory = false;
  waiting = false;
  const match = /^\/room\/([A-Z0-9]{6})\/?$/.exec(path);
  if (match && codePattern.test(match[1])) {
    screen = 'room';
    code = match[1];
    credential = read(credentialKey(code));
  } else {
    screen = path === '/create/custom' ? 'custom' : path === '/create' ? 'create' : path === '/join' ? 'join' : 'home';
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

async function avatarThumbnail(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = avatarSize;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, avatarSize, avatarSize);
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
      size, size, 0, 0, avatarSize, avatarSize);
    const jpeg = canvas.toDataURL('image/jpeg', 0.82);
    return jpeg.length - jpegPrefix.length <= maxAvatarLength ? jpeg : canvas.toDataURL('image/jpeg', 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function chooseAvatar(event) {
  const input = event.target;
  if (!input.matches('input[name="avatar"]')) return;
  const file = input.files[0];
  if (!file || waiting) return;
  const form = input.form;
  const submitButton = form.querySelector('[type="submit"]');
  const status = form.querySelector('.avatar-status');
  const isCurrent = () => form.isConnected && input.files[0] === file;
  submitButton.disabled = true;
  status.textContent = '正在处理照片…';
  try {
    if (file.size > maxAvatarFileSize) throw new Error('照片不能超过 20 MB。');
    const jpeg = await avatarThumbnail(file);
    if (!jpeg.startsWith(jpegPrefix) || jpeg.length - jpegPrefix.length > maxAvatarLength) throw new Error();
    if (!isCurrent()) return;
    form.dataset.avatar = jpeg.slice(jpegPrefix.length);
    const preview = form.querySelector('.avatar-preview');
    preview.src = jpeg;
    preview.hidden = false;
    form.querySelector('.avatar-clear').hidden = false;
    status.textContent = '';
    submitButton.disabled = false;
  } catch (error) {
    if (!isCurrent()) return;
    status.textContent = file.size > maxAvatarFileSize ? error.message : '无法读取照片，请尝试 JPG 或 PNG。';
    input.value = '';
    submitButton.disabled = false;
  }
}

async function submit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  if (waiting) return;
  const data = new FormData(form);
  if (form.dataset.form === 'sheriff-settings') {
    customSheriffMode = data.get('sheriffMode');
    root.querySelector('#sheriff-setting-value').textContent = sheriffModes[customSheriffMode];
    return dialog.close();
  }
  if (form.dataset.form === 'match-choice') {
    const command = JSON.parse(data.get('command'));
    const choices = data.getAll('choice').map(value => JSON.parse(value));
    return action('match-choice', { ...command, choice: form.dataset.multiple === 'true' ? choices : choices[0] });
  }
  if (form.dataset.form === 'join-code') {
    const value = data.get('code').trim().toUpperCase();
    if (!codePattern.test(value)) return message('请输入有效的房间号。');
    go(`/room/${value}`);
    return;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const avatar = form.dataset.avatar === '' ? null : form.dataset.avatar;
  if (form.dataset.form === 'profile') {
    if (avatar === undefined) return dialog.close();
    return action('avatar', { avatar });
  }
  const name = data.get('nickname');
  const period = epoch;
  waiting = true;
  submitButton.disabled = true;
  try {
    if (form.dataset.form === 'create') {
      const custom = screen === 'custom';
      const token = read(pendingCreateKey) ?? newToken();
      write(pendingCreateKey, token);
      const result = await request('/api/rooms', { name, board: custom ? 'custom' : board, tab, avatar,
        ...(custom ? { lineup: customLineup, sheriffMode: customSheriffMode } : {}) }, token);
      write(pendingCreateKey, null);
      write(credentialKey(result.code), token);
      if (period === epoch) go(`/room/${result.code}`);
    } else {
      credential ??= read(pendingJoinKey(code)) ?? newToken();
      write(pendingJoinKey(code), credential);
      const spectate = form.dataset.form === 'spectate-room';
      const next = await roomRequest('join', { name, avatar, spectate });
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
      if (info && ((error.code === 'FULL' && !info.full) || error.code === 'SEATS_AVAILABLE')) {
        const latest = await request(endpoint()).catch(() => null);
        if (period !== epoch) return;
        if (latest && latest.full !== info.full) {
          joinDraft = { name, avatar };
          info = latest;
          render();
        }
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
      if (['MATCH_ACTION', 'REPLACEMENT_UNAVAILABLE'].includes(error.code)) dialog.close();
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

function openMatchControl(command) {
  const { actions, window, matchId, self } = lobby.match;
  const requested = JSON.parse(command);
  if (window !== requested.window || matchId !== requested.matchId) return;
  const control = actions.find(entry => entry.kind === requested.kind);
  if (!control) return;
  const label = matchLabel(control);
  if (control.options) {
    const type = control.multiple ? 'checkbox' : 'radio';
    const options = control.options.map(value => `<label class="match-option"><input type="${type}" name="choice" value="${escape(JSON.stringify(value))}" ${control.multiple ? '' : 'required'}> ${escape(choiceLabel(value, control, lobby.seats))}</label>`).join('');
    const gun = self.nightAction?.kind === 'gun-check' ? `<p>${self.nightAction.canShoot ? '可以开枪' : '不能开枪'}</p>` : '';
    const knife = control.action === 'witch' && Object.hasOwn(self, 'wolfTarget')
      ? `<p>${self.wolfTarget ? `狼刀目标：${self.wolfTarget}号` : '今晚没有普通狼刀目标。'}</p>` : '';
    return showDialog(label, `<form class="stack" data-form="match-choice" data-multiple="${Boolean(control.multiple)}">
      <input type="hidden" name="command" value="${escape(command)}">${gun}${knife}<div class="match-options">${options}</div>
      <button type="submit" class="button primary">确认</button>
    </form>`);
  }
  const warnings = {
    'self-destruct': '自爆后你将出局。', 'publish-night': '向所有玩家公布昨夜信息？',
    'close-vote': '结束当前投票？', rematch: '返回准备阶段，在相同房间重新发牌？',
  };
  if (warnings[control.kind]) return confirm(label, warnings[control.kind], 'match-send', '确认', command);
  return action('match-choice', JSON.parse(command));
}

const helpTabs = { basic: '基本信息', flow: '操作流程', roles: '角色介绍', faq: '常见问题' };

function showHelp(tabName = 'basic') {
  const boardId = lobby?.board ?? info?.board ?? board;
  const selected = boardDetails(boardId, lobby?.lineup ?? info?.lineup);
  const tabs = `<nav class="help-tabs" aria-label="用法简介">${Object.entries(helpTabs).map(([id, name]) =>
    `<button type="button" class="preset" aria-pressed="${tabName === id}" data-action="help-tab" data-value="${id}">${name}</button>`).join('')}</nav>`;
  const nightNames = { knife: '狼刀', 'thief-start': '盗宝大师切换', mechanical: '机械狼技能', hunter: '猎人枪态' };
  const order = nightSchedules[boardId].filter(step => boardId !== 'custom' || step === 'knife' || selected.preview.includes(step))
    .map(step => nightNames[step] ?? roles[step].name).join(' → ');
  const election = (lobby?.sheriffMode ?? info?.sheriffMode) === 'none' ? '' : '警长竞选、';
  const pages = {
    basic: `<p>${selected.name} · ${selected.preview.length} 人</p><p>每位玩家使用自己的手机入座。发言和讨论可当面进行，或使用你们自己的语音通话。</p>`,
    flow: `<ol class="help-steps"><li>房主选择板子并邀请好友入座。</li><li>发放身份后，每位玩家查看并确认自己的身份。</li><li>房主开始游戏，仅轮到的玩家收到私密夜间操作。</li><li>进行${election}公布死讯、发言和放逐投票，直到对局结束。</li></ol><p>${order}</p>${boardId === 'thief' ? '<p>首夜跳过普通狼刀。</p>' : ''}`,
    faq: '<p>掉线后重新打开邀请链接或点「回到最近一局」。使用同一个浏览器可恢复座位、身份和操作进度。</p><p>若另一个页面正在使用本座位，可点「在此页继续」。</p>',
  };
  if (tabName === 'roles') {
    const ids = [...new Set([...selected.preview.filter(Boolean), ...(boardId === 'thief' ? thiefDraw : [])])];
    const wolves = new Set([...customRoleGroups.wolves, 'mechanical', 'thief']);
    const categories = [['狼人阵营', id => wolves.has(id)], ['好人阵营', id => !wolves.has(id) && id !== 'mixed'], ['其他角色', id => id === 'mixed']];
    pages.roles = `<label for="role-query">搜索角色名称</label><input id="role-query" data-role-query placeholder="例如 通灵师">${categories.map(([name, filter]) => {
      const list = ids.filter(filter);
      return list.length ? `<section class="help-role-group"><h3>${name}</h3>${list.map(id => `<details data-role-name="${roles[id].name}"><summary>${roleMark(id)}${roles[id].name}</summary><p>${roles[id].description}</p></details>`).join('')}</section>` : '';
    }).join('')}`;
  }
  showDialog('用法简介', tabs + pages[tabName]);
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
    if (root.dataset.screen === 'match-history' && link === homeLink) {
      showingHistory = false;
      return render();
    }
    go(link.pathname);
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const { action: command, value } = control.dataset;
  switch (command) {
    case 'home': return go('/');
    case 'create-screen': return go('/create');
    case 'custom-screen': return go('/create/custom');
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
    case 'custom-tab': {
      customTab = value;
      customQuery = '';
      root.querySelector('[data-custom-search]').value = '';
      for (const tabButton of root.querySelectorAll('[data-action="custom-tab"]')) {
        tabButton.setAttribute('aria-pressed', String(tabButton === control));
      }
      root.querySelector('.custom-options').innerHTML = customOptions();
      return;
    }
    case 'custom-role':
    case 'custom-remove': {
      const index = customLineup.indexOf(value);
      if (command === 'custom-remove' || (index !== -1 && !repeatableRole(value))) {
        customLineup.splice(index, 1);
      } else {
        customLineup.push(value);
      }
      const options = root.querySelector('.custom-options');
      options.innerHTML = customOptions();
      root.querySelector('.custom-preview').innerHTML = customPreview();
      if (event.detail === 0) {
        const replacement = options.querySelector(`[data-action="${command}"][data-value="${value}"]:enabled`)
          ?? options.querySelector(`[data-value="${value}"]:enabled`);
        replacement?.focus();
      }
      return;
    }
    case 'sheriff-settings': return showSheriffSettings();
    case 'create-details':
      if (screen === 'custom' && customLineupError(customLineup)) return;
      return showDialog('创建房间', profileForm('create', '确认创建'));
    case 'profile':
      return showDialog('编辑资料', profileForm('profile', '保存', lobby.self));
    case 'clear-avatar': {
      if (waiting) return;
      const form = control.form;
      const preview = form.querySelector('.avatar-preview');
      preview.removeAttribute('src');
      preview.hidden = control.hidden = true;
      form.querySelector('.avatar-file').value = '';
      form.querySelector('.avatar-status').textContent = '';
      form.querySelector('[type="submit"]').disabled = false;
      form.dataset.avatar = '';
      return;
    }
    case 'help': return showHelp();
    case 'help-tab': return showHelp(value);
    case 'invite':
      return showDialog('邀请好友', `<label for="invite-link">房间链接</label><input id="invite-link" value="${escape(inviteUrl())}" readonly>
        <div class="dialog-actions">${button('复制链接', 'copy-invite')}${navigator.share ? button('分享链接', 'share-invite', { variant: 'secondary' }) : ''}</div>`);
    case 'copy-invite': return copyInvite();
    case 'share-invite':
      try { await navigator.share({ title: '狼人杀 · 邀请好友', url: inviteUrl() }); }
      catch (error) { if (error.name !== 'AbortError') await copyInvite(); }
      return;
    case 'config': {
      const sheriff = lobby.board === 'custom' ? `<p class="config-sheriff">警徽设置：${sheriffModes[lobby.sheriffMode ?? defaultSheriffMode]}</p>` : '';
      return showDialog('本局配置', boardPreview(lobby.board, lobby.lineup, true) + sheriff);
    }
    case 'seat':
      return Number(value) === lobby.self.seat ? action('stand') : action('seat', { seat: Number(value) });
    case 'confirm-replacement': {
      const target = lobby.seats.find(guest => guest?.id === value);
      if (target) return confirm('申请替补', `申请接替 ${target.seat} 号座的 ${target.name}？`, 'replacement-request', '提交申请', target.id);
      return;
    }
    case 'replacement-request': return action(command, { target: value });
    case 'replacement-cancel': return action(command);
    case 'replacement-requests': {
      const requests = lobby.replacementRequests.map(request => `<li><span>${escape(request.name)} 申请替补 ${request.seat} 号座</span>
        ${button('同意', 'confirm-approval', { variant: 'secondary', value: request.id })}</li>`).join('');
      return showDialog('替补申请', requests ? `<ul class="guest-list">${requests}</ul>` : '<p>暂无待处理申请。</p>');
    }
    case 'confirm-approval': {
      const request = lobby.replacementRequests.find(entry => entry.id === value);
      if (request) return confirm('确认替补', `让 ${request.name} 接替 ${request.seat} 号座？原玩家将转为观战。`, 'replacement-approve', '确认替补', value);
      return dialog.close();
    }
    case 'replacement-approve': return action(command, { target: value });
    case 'confirm-deal':
      return confirm('发放身份', '发放后座位锁定，每位玩家只可查看自己的身份。', 'deal', '确认发放');
    case 'deal': return action('deal');
    case 'confirm-start': return confirm('开始游戏', '进入第 1 晚？', 'start-match', '开始游戏');
    case 'start-match': return action('match-start');
    case 'match-control': return openMatchControl(value);
    case 'match-send': return action('match-choice', JSON.parse(value));
    case 'match-history':
      showingHistory = true;
      return render();
    case 'vote-detail': {
      const event = lobby.match.history[Number(value)];
      if (!event?.ballot) return;
      const type = event.kind === 'sheriff-vote' ? '警长' : '';
      const runoff = event.runoff ? ' PK ' : '';
      return showDialog(`第${event.round}天${type}${runoff}投票详情`, voteDetail(event, button), 'ballot-dialog');
    }
    case 'reveal': return action('reveal');
    case 'acknowledge': return action('acknowledge');
    case 'manage': {
      if (lobby.match?.canAbandon) {
        return showDialog('房主操作', button('结束本局', 'confirm-abandon', { variant: 'secondary', value: lobby.match.canAbandon }));
      }
      const guests = [...lobby.seats.filter(Boolean), ...lobby.waiting].filter(guest => !guest.host);
      const list = guests.map(guest => `<li><span>${escape(guest.name)}${guest.seat ? ` · ${guest.seat}号` : ' · 未入座'}</span>${button('移除', 'confirm-remove', { variant: 'secondary', value: guest.id })}</li>`).join('');
      return showDialog('房主操作', list ? `<ul class="guest-list">${list}</ul>` : '<p>目前没有其他玩家。</p>');
    }
    case 'confirm-abandon': return confirm('结束本局', '结束此局后，所有玩家可回到准备阶段重新发牌。', 'abandon-match', '确认结束', value);
    case 'abandon-match': return action('match-abandon', { matchId: value });
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
document.addEventListener('change', chooseAvatar);
root.addEventListener('input', event => {
  if (!event.target.matches('[data-custom-search]')) return;
  customQuery = event.target.value.trim();
  root.querySelector('.custom-options').innerHTML = customOptions();
});
dialog.addEventListener('input', event => {
  if (!event.target.matches('[data-role-query]')) return;
  const query = event.target.value.trim();
  for (const group of dialog.querySelectorAll('.help-role-group')) {
    let found = false;
    for (const entry of group.querySelectorAll('[data-role-name]')) {
      entry.hidden = !entry.dataset.roleName.includes(query);
      found ||= !entry.hidden;
    }
    group.hidden = !found;
  }
});
document.addEventListener('click', click);
dialog.addEventListener('close', () => { if (!dialog.open) dialog.replaceChildren(); });
window.addEventListener('popstate', () => go(location.pathname, true));
window.addEventListener('online', () => schedulePoll(0));
window.addEventListener('pagehide', leaveConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePoll(0); });
go(location.pathname, true);

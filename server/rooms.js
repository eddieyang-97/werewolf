import { createHash, randomInt, randomUUID } from 'node:crypto';
import jpeg from 'jpeg-js';
import {
  boards, customLineupError, customRuleOptions, defaultCustomRules, defaultSheriffMode, presetSeatCount, sheriffModes,
} from '../public/boards.js';
import { buildDeck, shuffle } from './deal.js';
import { abandonMatch, controllerView, executeMatchChoice, startMatch } from './match-controller.js';
import { publicSpeaker } from './match-view.js';
import { progressNightCue } from './night-actions.js';

const ONLINE_WINDOW = 15_000;
const HEARTBEAT_INTERVAL = 4_000;
const RETENTION = 24 * 60 * 60 * 1000;
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const AVATAR_SIZE = 128;
const AVATAR_BYTES = 12_288;
const SPECTATOR_LIMIT = 24;

export class RoomError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function roomError(status, code, message) {
  throw new RoomError(status, code, message);
}

function validateNickname(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!name || Array.from(name).length > 20 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    roomError(400, 'NICKNAME', '请输入 1 至 20 个字符的昵称。');
  }
  return name;
}

function validateAvatar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.length <= AVATAR_BYTES * 4 / 3 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    try {
      const { data, width, height } = jpeg.decode(Buffer.from(value, 'base64'), {
        maxResolutionInMP: AVATAR_SIZE ** 2 / 1_000_000,
        maxMemoryUsageInMB: 4,
        tolerantDecoding: false,
      });
      if (width === AVATAR_SIZE && height === AVATAR_SIZE) {
        const frame = { data, width, height };
        const image = jpeg.encode(frame, 75).data;
        const thumbnail = image.length <= AVATAR_BYTES ? image : jpeg.encode(frame, 55).data;
        if (thumbnail.length <= AVATAR_BYTES) return { id: randomUUID(), jpeg: thumbnail.toString('base64') };
      }
    } catch {
      // Corrupt and oversized photos share the same validation response.
    }
  }
  roomError(400, 'AVATAR', '无法读取头像，请重新选择照片。');
}

export function tokenKey(token) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) roomError(401, 'CREDENTIAL', '房间凭证无效。');
  return createHash('sha256').update(token).digest('hex');
}

function validId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
}

function validateTab(tab) {
  if (!validId(tab)) roomError(400, 'TAB', '请重新打开房间。');
}

function newGuest(name, key, tab, now) {
  return { id: randomUUID(), name, key, tab, seat: null, lastSeen: now, revealed: false, acknowledged: false, receipts: [] };
}

function guestFor(room, key) {
  const guest = room.guests.find(item => item.key === key);
  if (!guest) roomError(401, 'SESSION_ENDED', '房间会话已结束，请返回首页或重新加入。');
  return guest;
}

function seesTab(guest, tab) {
  if (guest.tab !== tab) roomError(409, 'TAKEN_OVER', '另一个页面正在使用此房间会话。');
}

function isOnline(guest, now) {
  return guest && guest.lastSeen !== null && now - guest.lastSeen < ONLINE_WINDOW;
}

function refreshPresence(room, guest, now) {
  if (guest.seat !== null && !isOnline(guest, now)) clearReplacementRequests(room, guest.id);
  guest.lastSeen = now;
  room.expiresAt = now + ONLINE_WINDOW + RETENTION;
}

function clearReplacementRequests(room, target) {
  for (const guest of room.guests) {
    if (guest.replacement?.target === target) delete guest.replacement;
  }
}

function replacementTarget(room, id, now) {
  if (!id || room.match?.winner || id === room.hostId) return;
  return room.guests.find(guest => guest.id === id && guest.seat !== null && !isOnline(guest, now));
}

function refreshMatchTimer(room, now) {
  const match = room.match;
  if (!match?.timer) return false;
  const speaker = room.guests.find(guest => guest.seat === publicSpeaker(match));
  const { deadline, remaining } = match.timer;
  if (isOnline(speaker, now) && remaining > 0) {
    match.timer = { deadline: now + remaining };
    return true;
  }
  if (!isOnline(speaker, now) && deadline) {
    const cutoff = speaker?.lastSeen == null ? now : Math.min(now, speaker.lastSeen + ONLINE_WINDOW);
    match.timer = { remaining: Math.max(0, deadline - cutoff) };
    return true;
  }
  return false;
}

function presentGuest(guest, room, now) {
  return {
    id: guest.id,
    name: guest.name,
    avatar: guest.avatar ? `/api/rooms/${room.code}/avatar/${guest.avatar.id}` : null,
    seat: guest.seat,
    connected: isOnline(guest, now),
    host: guest.id === room.hostId,
    acknowledged: guest.acknowledged,
    ...(guest.spectator ? { spectator: true } : {}),
  };
}

function ownProfile(guest) {
  return { name: guest.name, avatar: guest.avatar?.jpeg ?? null };
}

function seatsIn(room) {
  return room.lineup?.length ?? presetSeatCount;
}

function publicStatus(room, now) {
  const seated = room.guests.filter(guest => guest.seat !== null);
  const seatCount = seatsIn(room);
  const ready = room.dealt && seated.every(guest => guest.acknowledged);
  return {
    code: room.code,
    board: room.board,
    ...(room.lineup ? {
      lineup: room.lineup,
      sheriffMode: room.sheriffMode ?? defaultSheriffMode,
      customRules: { ...defaultCustomRules, ...room.customRules },
    } : {}),
    state: room.match ? (room.match.winner ? 'finished' : 'playing') : ready ? 'ready' : room.dealt ? 'dealt' : 'lobby',
    full: seated.length === seatCount,
    seated,
    canDeal: !room.dealt && seated.length === seatCount && seated.some(guest => guest.id === room.hostId)
      && seated.every(guest => isOnline(guest, now)),
  };
}

function snapshot(room, viewer, now, matchRules) {
  const { seated, ...status } = publicStatus(room, now);
  const watching = room.guests.filter(guest => guest.spectator && isOnline(guest, now));
  const result = {
    ...status,
    canDeal: status.canDeal && viewer.id === room.hostId,
    seats: Array.from({ length: seatsIn(room) }, (_, index) => {
      const guest = seated.find(item => item.seat === index + 1);
      return guest ? presentGuest(guest, room, now) : null;
    }),
    waiting: room.guests.filter(guest => guest.seat === null && !guest.spectator).map(guest => presentGuest(guest, room, now)),
    self: { ...presentGuest(viewer, room, now), revealed: viewer.revealed },
    spectatorCount: watching.length,
  };
  if (viewer.spectator) {
    result.self.canRequestReplacement = !viewer.replaced && !room.match?.winner;
    result.self.replacementSeat = replacementTarget(room, viewer.replacement?.target, now)?.seat ?? null;
  }
  if (viewer.id === room.hostId) {
    result.replacementRequests = watching.flatMap(spectator => {
      const target = replacementTarget(room, spectator.replacement?.target, now);
      return target ? [{ id: spectator.replacement.id, name: spectator.name, seat: target.seat }] : [];
    });
  }
  if (matchRules && viewer.id === room.hostId && status.state === 'ready') {
    result.canStart = status.full && seated.every(guest => isOnline(guest, now));
  }
  if (matchRules && room.match) {
    result.match = controllerView(room.match, viewer.seat, viewer.id === room.hostId, matchRules);
    if (viewer.id === room.hostId && !room.match.winner) result.match.canAbandon = room.match.id;
  }
  return result;
}

function assertHost(room, guest) {
  if (room.hostId !== guest.id) roomError(403, 'HOST_ONLY', '只有房主可以执行此操作。');
}

function assertLobby(room) {
  if (room.dealt) roomError(409, 'LOCKED', '身份已发放，座位已锁定。');
}

function approveReplacement(room, command, now) {
  const spectator = room.guests.find(guest => guest.spectator && guest.replacement && guest.replacement.id === command.target);
  const target = spectator?.replacement && replacementTarget(room, spectator.replacement.target, now);
  if (!target || !isOnline(spectator, now)) roomError(409, 'REPLACEMENT_UNAVAILABLE', '该替补申请已失效。');

  spectator.seat = target.seat;
  if (target.assignment) spectator.assignment = target.assignment;
  spectator.acknowledged = Boolean(room.match);
  delete spectator.spectator;
  clearReplacementRequests(room, target.id);

  target.seat = null;
  target.spectator = true;
  if (room.dealt) target.replaced = true;
  delete target.assignment;
  target.revealed = target.acknowledged = false;
}

function applyAction(room, guest, command, now, matchRules) {
  switch (command.type) {
    case 'replacement-request':
      if (!guest.spectator || guest.replaced || !replacementTarget(room, command.target, now)) {
        roomError(409, 'REPLACEMENT_UNAVAILABLE', '该座位目前无法替补。');
      }
      guest.replacement = { id: randomUUID(), target: command.target };
      return;
    case 'replacement-cancel':
      if (!guest.spectator) roomError(409, 'REPLACEMENT_UNAVAILABLE', '该替补申请已失效。');
      delete guest.replacement;
      return;
    case 'replacement-approve':
      assertHost(room, guest);
      approveReplacement(room, command, now);
      return;
    case 'host-transfer': {
      assertHost(room, guest);
      const target = room.guests.find(item => item.id === command.target && item.id !== guest.id && item.seat !== null);
      if (!isOnline(target, now)) roomError(409, 'HOST_TARGET', '请选择另一位在线且已入座的玩家。');
      clearReplacementRequests(room, target.id);
      room.hostId = target.id;
      return;
    }
    case 'seat': {
      assertLobby(room);
      if (!Number.isInteger(command.seat) || command.seat < 1 || command.seat > seatsIn(room)) {
        roomError(400, 'SEAT', '请选择有效座位。');
      }
      const occupant = room.guests.find(item => item.seat === command.seat);
      if (occupant && occupant.id !== guest.id) roomError(409, 'OCCUPIED', '这个座位已被占用。');
      guest.seat = command.seat;
      return;
    }
    case 'stand':
      assertLobby(room);
      guest.seat = null;
      return;
    case 'avatar':
      if (command.avatar === undefined) roomError(400, 'AVATAR', '请选择照片或移除头像。');
      guest.avatar = validateAvatar(command.avatar);
      guest.avatarActionId = command.id;
      return;
    case 'remove': {
      assertHost(room, guest);
      assertLobby(room);
      if (command.target === guest.id) roomError(400, 'SELF_REMOVE', '房主不能移除自己。');
      const targetIndex = room.guests.findIndex(item => item.id === command.target);
      if (targetIndex < 0) roomError(404, 'GUEST_GONE', '该玩家已离开。');
      const [removed] = room.guests.splice(targetIndex, 1);
      clearReplacementRequests(room, removed.id);
      (room.revoked ??= []).push(removed.key);
      return;
    }
    case 'deal': {
      assertHost(room, guest);
      assertLobby(room);
      const { seated, canDeal } = publicStatus(room, now);
      if (!canDeal) roomError(409, 'NOT_READY', '包括房主在内的所有玩家都入座并在线后才可发放身份。');
      const deck = shuffle(buildDeck(room.board, undefined, room.lineup));
      const seatedIds = new Set(seated.map(item => item.id));
      for (const player of seated) player.assignment = deck[player.seat - 1];
      room.guests = room.guests.filter(item => seatedIds.has(item.id) || item.spectator);
      room.dealt = true;
      return;
    }
    case 'reveal':
      if (!guest.assignment) roomError(409, 'NOT_DEALT', '身份尚未发放。');
      guest.revealed = true;
      return;
    case 'acknowledge':
      if (!guest.revealed) roomError(409, 'NOT_REVEALED', '请先查看自己的身份。');
      guest.acknowledged = true;
      return;
    case 'match-start': {
      if (!matchRules) roomError(409, 'MATCH_UNAVAILABLE', '当前房间暂未开放正式对局。');
      assertHost(room, guest);
      const { state, full, seated } = publicStatus(room, now);
      if (state !== 'ready' || !full || !seated.every(player => isOnline(player, now))) {
        roomError(409, 'NOT_READY', '所有玩家准备就绪并在线后才可开始对局。');
      }
      startMatch(room, matchRules, command.nightNarration === true, now);
      return;
    }
    case 'match-choice':
      if (!matchRules || !executeMatchChoice(room, guest, command, matchRules, now)) {
        roomError(409, 'MATCH_ACTION', '当前无法执行此对局操作，请刷新进度。');
      }
      return;
    case 'match-abandon': {
      assertHost(room, guest);
      const { winner = 'abandoned' } = command;
      if (!matchRules || !room.match || room.match.winner || room.match.id !== command.matchId
        || !['abandoned', 'wolves', 'village'].includes(winner)) {
        roomError(409, 'MATCH_ACTION', '当前无法结束此对局。');
      }
      abandonMatch(room.match, winner);
      return;
    }
    default:
      roomError(400, 'ACTION', '无法识别此操作。');
  }
}

export function createRooms(store, clock = Date.now, matchRules) {
  function withRoom(code, action) {
    const now = clock();
    return store.room(code, now, room => {
      if (!room) roomError(404, 'ROOM_GONE', '房间不存在或已过期。');
      return action(room, now);
    });
  }

  return {
    async create(board, name, token, tab, avatar, lineup, sheriffMode, customRules) {
      validateTab(tab);
      if (customRules !== undefined && (
        board !== 'custom' || !customRules || typeof customRules !== 'object' || Array.isArray(customRules)
        || !Object.entries(customRules).every(([key, value]) => Object.hasOwn(customRuleOptions, key)
          && typeof value === 'string' && Object.hasOwn(customRuleOptions[key], value))
      )) {
        roomError(400, 'CUSTOM_RULES', '请选择有效的自定义规则。');
      }
      if (board === 'custom') {
        const error = customLineupError(lineup, customRules?.victoryMode);
        if (error) roomError(400, 'LINEUP', error);
      } else if (typeof board !== 'string' || !Object.hasOwn(boards, board)) {
        roomError(400, 'BOARD', '请选择一个板子。');
      } else if (lineup !== undefined) {
        roomError(400, 'LINEUP', '请选择自定义配置来调整角色。');
      }
      if (sheriffMode !== undefined && (board !== 'custom' || typeof sheriffMode !== 'string' || !Object.hasOwn(sheriffModes, sheriffMode))) {
        roomError(400, 'SHERIFF_MODE', '请选择有效的警徽设置。');
      }
      const key = tokenKey(token);
      const now = clock();
      const host = newGuest(validateNickname(name), key, tab, now);
      host.seat = 1;
      host.avatar = validateAvatar(avatar);
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
        const room = { code, board, hostId: host.id, guests: [host], dealt: false, expiresAt: now + ONLINE_WINDOW + RETENTION };
        if (board === 'custom') {
          room.lineup = [...lineup];
          room.sheriffMode = sheriffMode ?? defaultSheriffMode;
          room.customRules = { ...defaultCustomRules, ...customRules };
        }
        const result = await store.create(room, key, now);
        if (result) return { code: result.code, profile: ownProfile(guestFor(result, key)) };
      }
      roomError(503, 'CREATE', '暂时无法创建房间，请重试。');
    },

    info(code) {
      return withRoom(code, (room, now) => {
        const { board, state, full, lineup, sheriffMode, customRules } = publicStatus(room, now);
        return { value: { code, board, state, full, lineup, sheriffMode, customRules } };
      });
    },

    avatar(code, id) {
      return withRoom(code, room => {
        const guest = room.guests.find(item => item.avatar?.id === id);
        if (!guest) roomError(404, 'AVATAR_GONE', '头像不存在。');
        return { value: Buffer.from(guest.avatar.jpeg, 'base64') };
      });
    },

    join(code, name, token, tab, avatar, spectate = false) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        if (room.revoked?.includes(key)) roomError(401, 'SESSION_ENDED', '房间会话已结束，请重新加入。');
        let guest = room.guests.find(item => item.key === key);
        if (!guest) {
          const status = publicStatus(room, now);
          if (spectate) {
            if (!status.full) roomError(409, 'SEATS_AVAILABLE', '房间有空座，请加入房间。');
            if (room.guests.filter(item => item.spectator).length >= SPECTATOR_LIMIT) {
              roomError(409, 'SPECTATORS_FULL', '观战人数已满。');
            }
          } else {
            if (status.full || room.guests.filter(item => !item.spectator).length >= 24) {
              roomError(409, 'FULL', '房间已满。');
            }
            assertLobby(room);
          }
          const nickname = validateNickname(name);
          if (room.guests.some(item => item.name.toLowerCase() === nickname.toLowerCase())) {
            roomError(409, 'NAME_TAKEN', '该昵称已被使用。');
          }
          guest = newGuest(nickname, key, tab, now);
          guest.avatar = validateAvatar(avatar);
          if (spectate) guest.spectator = true;
          room.guests.push(guest);
        } else {
          seesTab(guest, tab);
        }
        refreshPresence(room, guest, now);
        return { changed: true, value: { ...snapshot(room, guest, now, matchRules), profile: ownProfile(guest) } };
      });
    },

    sync(code, token, tab, { takeControl = false, includeProfile = false, pendingAvatarId, seenNightCue } = {}) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        if (!takeControl) seesTab(guest, tab);
        const timerChanged = refreshMatchTimer(room, now);
        const presenceChanged = guest.tab !== tab || guest.lastSeen === null || now - guest.lastSeen >= HEARTBEAT_INTERVAL;
        if (presenceChanged) {
          guest.tab = tab;
          refreshPresence(room, guest, now);
        }
        const timerResumed = refreshMatchTimer(room, now);
        const cueChecked = !takeControl && guest.id === room.hostId && matchRules
          && progressNightCue(room.match, seenNightCue, matchRules, now);
        const value = snapshot(room, guest, now, matchRules);
        if (includeProfile || (validId(pendingAvatarId) && guest.avatarActionId === pendingAvatarId)) {
          value.profile = ownProfile(guest);
        }
        return { changed: presenceChanged || timerChanged || timerResumed || cueChecked, value };
      });
    },

    disconnect(code, token, tab) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        if (guest.tab !== tab) return { value: {} };
        refreshMatchTimer(room, now);
        guest.lastSeen = null;
        refreshMatchTimer(room, now);
        if (!room.guests.some(item => isOnline(item, now))) room.expiresAt = now + RETENTION;
        return { changed: true, value: {} };
      });
    },

    action(code, token, tab, command) {
      validateTab(tab);
      if (!validId(command.id)) roomError(400, 'ACTION_ID', '操作凭证无效，请重试。');
      const key = tokenKey(token);
      let signature = JSON.stringify([command.type, command.seat, command.target]);
      if (command.type === 'match-start' && command.nightNarration !== undefined) {
        if (typeof command.nightNarration !== 'boolean') roomError(400, 'NIGHT_NARRATION', '请选择是否开启夜间语音。');
        if (command.nightNarration) signature = JSON.stringify([command.type, true]);
      }
      if (command.type === 'avatar') signature = createHash('sha256').update(JSON.stringify([command.avatar])).digest('hex');
      if (command.type === 'match-choice') {
        signature = JSON.stringify([command.type, command.matchId, command.window, command.kind, command.choice]);
      }
      if (command.type === 'match-abandon') {
        const { winner } = command;
        signature = JSON.stringify(winner === undefined ? [command.type, command.matchId] : [command.type, command.matchId, winner]);
      }
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        seesTab(guest, tab);
        if (guest.spectator && !['replacement-request', 'replacement-cancel'].includes(command.type)) {
          roomError(403, 'SPECTATOR_ONLY', '观战时无法执行玩家操作。');
        }
        const previous = guest.receipts.find(receipt => receipt.id === command.id);
        if (previous && previous.signature !== signature) roomError(409, 'ACTION_ID', '此操作凭证已被使用。');
        refreshMatchTimer(room, now);
        refreshPresence(room, guest, now);
        if (!previous) {
          applyAction(room, guest, command, now, matchRules);
          guest.receipts.push({ id: command.id, signature });
          if (guest.receipts.length > 64) guest.receipts.shift();
        }
        refreshMatchTimer(room, now);
        const value = { room: snapshot(room, guest, now, matchRules) };
        if (command.type === 'reveal') value.assignment = guest.assignment;
        if (command.type === 'avatar' && guest.avatarActionId === command.id) value.profile = ownProfile(guest);
        return { changed: true, value };
      });
    },
  };
}

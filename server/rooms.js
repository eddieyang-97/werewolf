import { createHash, randomInt, randomUUID } from 'node:crypto';
import jpeg from 'jpeg-js';
import { boards } from '../public/boards.js';
import { buildDeck, shuffle } from './deal.js';

const SEAT_COUNT = 12;
const ONLINE_WINDOW = 15_000;
const HEARTBEAT_INTERVAL = 4_000;
const RETENTION = 24 * 60 * 60 * 1000;
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const AVATAR_SIZE = 128;
const AVATAR_BYTES = 12_288;

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
  if (guest.tab !== tab) roomError(409, 'TAKEN_OVER', '另一个页面正在使用这个座位。');
}

function isOnline(guest, now) {
  return guest && guest.lastSeen !== null && now - guest.lastSeen < ONLINE_WINDOW;
}

function refreshPresence(room, guest, now) {
  guest.lastSeen = now;
  room.expiresAt = now + ONLINE_WINDOW + RETENTION;
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
  };
}

function publicStatus(room, now) {
  const seated = room.guests.filter(guest => guest.seat !== null);
  return {
    code: room.code,
    board: room.board,
    state: room.dealt ? (seated.every(guest => guest.acknowledged) ? 'ready' : 'dealt') : 'lobby',
    full: seated.length === SEAT_COUNT,
    seated,
    canDeal: !room.dealt && seated.length === SEAT_COUNT && seated.some(guest => guest.id === room.hostId)
      && seated.every(guest => isOnline(guest, now)),
  };
}

function snapshot(room, viewer, now) {
  const { seated, ...status } = publicStatus(room, now);
  return {
    ...status,
    canDeal: status.canDeal && viewer.id === room.hostId,
    seats: Array.from({ length: SEAT_COUNT }, (_, index) => {
      const guest = seated.find(item => item.seat === index + 1);
      return guest ? presentGuest(guest, room, now) : null;
    }),
    waiting: room.guests.filter(guest => guest.seat === null).map(guest => presentGuest(guest, room, now)),
    self: presentGuest(viewer, room, now),
  };
}

function assertHost(room, guest) {
  if (room.hostId !== guest.id) roomError(403, 'HOST_ONLY', '只有房主可以执行此操作。');
}

function assertLobby(room) {
  if (room.dealt) roomError(409, 'LOCKED', '身份已发放，座位已锁定。');
}

function applyAction(room, guest, command, now) {
  switch (command.type) {
    case 'seat': {
      assertLobby(room);
      if (!Number.isInteger(command.seat) || command.seat < 1 || command.seat > SEAT_COUNT) {
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
      return;
    case 'remove': {
      assertHost(room, guest);
      assertLobby(room);
      if (command.target === guest.id) roomError(400, 'SELF_REMOVE', '房主不能移除自己。');
      const targetIndex = room.guests.findIndex(item => item.id === command.target);
      if (targetIndex < 0) roomError(404, 'GUEST_GONE', '该玩家已离开。');
      const [removed] = room.guests.splice(targetIndex, 1);
      (room.revoked ??= []).push(removed.key);
      return;
    }
    case 'deal': {
      assertHost(room, guest);
      assertLobby(room);
      const { seated, canDeal } = publicStatus(room, now);
      if (!canDeal) roomError(409, 'NOT_READY', '包括房主在内的 12 位玩家都入座并在线后才可发放身份。');
      const deck = shuffle(buildDeck(room.board));
      const seatedIds = new Set(seated.map(item => item.id));
      for (const player of seated) player.assignment = deck[player.seat - 1];
      room.guests = room.guests.filter(item => seatedIds.has(item.id));
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
    default:
      roomError(400, 'ACTION', '无法识别此操作。');
  }
}

export function createRooms(store, clock = Date.now) {
  function withRoom(code, action) {
    const now = clock();
    return store.room(code, now, room => {
      if (!room) roomError(404, 'ROOM_GONE', '房间不存在或已过期。');
      return action(room, now);
    });
  }

  return {
    async create(board, name, token, tab, avatar) {
      validateTab(tab);
      if (typeof board !== 'string' || !Object.hasOwn(boards, board)) roomError(400, 'BOARD', '请选择一个板子。');
      const key = tokenKey(token);
      const now = clock();
      const host = newGuest(validateNickname(name), key, tab, now);
      host.seat = 1;
      host.avatar = validateAvatar(avatar);
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
        const room = { code, board, hostId: host.id, guests: [host], dealt: false, expiresAt: now + ONLINE_WINDOW + RETENTION };
        const result = await store.create(room, key, now);
        if (result) return { code: result.code };
      }
      roomError(503, 'CREATE', '暂时无法创建房间，请重试。');
    },

    info(code) {
      return withRoom(code, (room, now) => {
        const { board, state, full } = publicStatus(room, now);
        return { value: { code, board, state, full } };
      });
    },

    avatar(code, id) {
      return withRoom(code, room => {
        const guest = room.guests.find(item => item.avatar?.id === id);
        if (!guest) roomError(404, 'AVATAR_GONE', '头像不存在。');
        return { value: Buffer.from(guest.avatar.jpeg, 'base64') };
      });
    },

    join(code, name, token, tab, avatar) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        if (room.revoked?.includes(key)) roomError(401, 'SESSION_ENDED', '房间会话已结束，请重新加入。');
        let guest = room.guests.find(item => item.key === key);
        if (!guest) {
          const status = publicStatus(room, now);
          if (status.full || room.guests.length >= 24) roomError(409, 'FULL', '房间已满。');
          assertLobby(room);
          const nickname = validateNickname(name);
          if (room.guests.some(item => item.name.toLowerCase() === nickname.toLowerCase())) {
            roomError(409, 'NAME_TAKEN', '该昵称已被使用。');
          }
          guest = newGuest(nickname, key, tab, now);
          guest.avatar = validateAvatar(avatar);
          room.guests.push(guest);
        } else {
          seesTab(guest, tab);
        }
        refreshPresence(room, guest, now);
        return { changed: true, value: snapshot(room, guest, now) };
      });
    },

    sync(code, token, tab, takeControl = false) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        if (!takeControl) seesTab(guest, tab);
        const changed = guest.tab !== tab || guest.lastSeen === null || now - guest.lastSeen >= HEARTBEAT_INTERVAL;
        if (changed) {
          guest.tab = tab;
          refreshPresence(room, guest, now);
        }
        return { changed, value: snapshot(room, guest, now) };
      });
    },

    disconnect(code, token, tab) {
      validateTab(tab);
      const key = tokenKey(token);
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        if (guest.tab !== tab) return { value: {} };
        guest.lastSeen = null;
        if (!room.guests.some(item => isOnline(item, now))) room.expiresAt = now + RETENTION;
        return { changed: true, value: {} };
      });
    },

    action(code, token, tab, command) {
      validateTab(tab);
      if (!validId(command.id)) roomError(400, 'ACTION_ID', '操作凭证无效，请重试。');
      const key = tokenKey(token);
      const signature = command.type === 'avatar'
        ? createHash('sha256').update(JSON.stringify([command.avatar])).digest('hex')
        : JSON.stringify([command.type, command.seat, command.target]);
      return withRoom(code, (room, now) => {
        const guest = guestFor(room, key);
        seesTab(guest, tab);
        const previous = guest.receipts.find(receipt => receipt.id === command.id);
        if (previous && previous.signature !== signature) roomError(409, 'ACTION_ID', '此操作凭证已被使用。');
        refreshPresence(room, guest, now);
        if (!previous) {
          applyAction(room, guest, command, now);
          guest.receipts.push({ id: command.id, signature });
          if (guest.receipts.length > 64) guest.receipts.shift();
        }
        const value = { room: snapshot(room, guest, now) };
        if (command.type === 'reveal') value.assignment = guest.assignment;
        return { changed: true, value };
      });
    },
  };
}

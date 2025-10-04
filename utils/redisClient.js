const Redis = require('ioredis');
const redisClient = new Redis();

const GAME_ROOM_PREFIX = 'dama:room:';
const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function getRoomKey(fixtureId) {
  return `${GAME_ROOM_PREFIX}${fixtureId}`;
}

// Create or join a room
async function createOrJoinRoom(fixtureId, userId, betAmount = 0) {
  const key = getRoomKey(fixtureId);
  const roomData = await redisClient.get(key);

  if (!roomData) {
    // Create new room with Player 1
    const room = {
      players: [userId],
      status: 'waiting',
      betAmount,
      createdAt: Date.now()
    };
    await redisClient.set(key, JSON.stringify(room));

    // Schedule auto-delete if nobody joins within timeout
    setTimeout(async () => {
      const r = await getRoom(fixtureId);
      if (r && r.players.length === 1) {
        await deleteRoom(fixtureId);
        console.log(`Room ${fixtureId} deleted automatically (empty)`);
      }
    }, EMPTY_ROOM_TIMEOUT);

    return { room, created: true };
  } else {
    const room = JSON.parse(roomData);
    if (room.players.length < 2 && !room.players.includes(userId)) {
      room.players.push(userId);
      room.status = 'ready';
      await redisClient.set(key, JSON.stringify(room));
      return { room, created: false };
    } else {
      return { error: 'Room full or already joined' };
    }
  }
}

// Get room by ID
async function getRoom(fixtureId) {
  const key = getRoomKey(fixtureId);
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

// Update room info
async function updateRoom(fixtureId, roomData) {
  const key = getRoomKey(fixtureId);
  await redisClient.set(key, JSON.stringify(roomData));
}

// Delete room
async function deleteRoom(fixtureId) {
  const key = getRoomKey(fixtureId);
  await redisClient.del(key);
}

// Leave a room (remove a player, delete if empty)
async function leaveRoom(fixtureId, userId) {
  const room = await getRoom(fixtureId);
  if (!room) return { error: 'Room not found' };

  room.players = room.players.filter(p => p !== userId);

  if (room.players.length === 0) {
    await deleteRoom(fixtureId);
    return { room: null, deleted: true };
  } else {
    room.status = 'waiting';
    await updateRoom(fixtureId, room);
    return { room, deleted: false };
  }
}

// Fetch all available rooms
async function getAllRooms() {
  const keys = await redisClient.keys(`${GAME_ROOM_PREFIX}*`);
  const rooms = [];
  for (const key of keys) {
    const data = await redisClient.get(key);
    const room = JSON.parse(data);
    room.roomId = key.split(':')[2];
    rooms.push(room);
  }
  return rooms;
}

module.exports = {
  redisClient,
  createOrJoinRoom,
  getRoom,
  updateRoom,
  deleteRoom,
  leaveRoom,
  getAllRooms,
};

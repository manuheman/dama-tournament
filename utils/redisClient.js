const Redis = require('ioredis');
const redisClient = new Redis();

const GAME_ROOM_PREFIX = 'dama:room:';

function getRoomKey(fixtureId) {
  return `${GAME_ROOM_PREFIX}${fixtureId}`;
}

async function createOrJoinRoom(fixtureId, userId) {
  const key = getRoomKey(fixtureId);
  const roomData = await redisClient.get(key);

  if (!roomData) {
    // Create new room with Player 1
    const room = {
      players: [userId],
      status: 'waiting',
    };
    await redisClient.set(key, JSON.stringify(room));
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

async function getRoom(fixtureId) {
  const key = getRoomKey(fixtureId);
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

async function updateRoom(fixtureId, roomData) {
  const key = getRoomKey(fixtureId);
  await redisClient.set(key, JSON.stringify(roomData));
}

async function deleteRoom(fixtureId) {
  const key = getRoomKey(fixtureId);
  await redisClient.del(key);
}

module.exports = {
  redisClient,         // export the Redis client instance!
  createOrJoinRoom,
  getRoom,
  updateRoom,
  deleteRoom,
};

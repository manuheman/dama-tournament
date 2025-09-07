const redis = require('redis');
const client = redis.createClient();

client.connect().then(() => {
  console.log('✅ Redis client connected');
}).catch(console.error);

// Room schema:
// key: `room:${fixtureId}`
// value: JSON.stringify({
//   players: [userId1, userId2],
//   board: [...],
//   status: 'waiting' | 'active',
//   currentPlayer: userId
// })

async function getRoom(fixtureId) {
  const key = `room:${fixtureId}`;
  const data = await client.get(key);
  if (!data) return null;
  return JSON.parse(data);
}

async function createRoom(fixtureId, userId, board) {
  const key = `room:${fixtureId}`;
  const room = {
    players: [userId],
    board,
    status: 'waiting',
    currentPlayer: null,
  };
  await client.set(key, JSON.stringify(room));
}

async function addPlayerToRoom(fixtureId, userId) {
  const key = `room:${fixtureId}`;
  const room = await getRoom(fixtureId);
  if (!room) throw new Error('Room not found');
  if (room.players.length >= 2) throw new Error('Room full');

  room.players.push(userId);
  await client.set(key, JSON.stringify(room));
}

async function updateRoomBoard(fixtureId, board) {
  const key = `room:${fixtureId}`;
  const room = await getRoom(fixtureId);
  if (!room) throw new Error('Room not found');
  room.board = board;
  await client.set(key, JSON.stringify(room));
}

async function updateRoomStatus(fixtureId, status) {
  const key = `room:${fixtureId}`;
  const room = await getRoom(fixtureId);
  if (!room) throw new Error('Room not found');
  room.status = status;
  await client.set(key, JSON.stringify(room));
}

async function updateCurrentPlayer(fixtureId, userId) {
  const key = `room:${fixtureId}`;
  const room = await getRoom(fixtureId);
  if (!room) throw new Error('Room not found');
  room.currentPlayer = userId;
  await client.set(key, JSON.stringify(room));
}

module.exports = {
  getRoom,
  createRoom,
  addPlayerToRoom,
  updateRoomBoard,
  updateRoomStatus,
  updateCurrentPlayer
};

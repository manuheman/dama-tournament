const express = require('express');
const router = express.Router();
const GameRoom = require('../models/gameroom');
const { v4: uuidv4 } = require('uuid');

const redisHelper = require('../utils/redisHelper');
const {
  createRoom,
  addPlayerToRoom,
  getRoom,
  updateGameState,
  deleteRoom,
} = redisHelper;

const BOARD_SIZE = 8;

// 🎯 Initialize game pieces (standard checkers setup)
function initialPieces() {
  const pieces = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) {
        pieces.push({ row: r, col: c, player: 2, king: false });
      }
    }
  }
  for (let r = BOARD_SIZE - 3; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if ((r + c) % 2 === 1) {
        pieces.push({ row: r, col: c, player: 1, king: false });
      }
    }
  }
  return pieces;
}

// POST /api/game-rooms/join
// Player joins an existing Redis room or creates a new one
router.post('/join', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Find any Redis room with only 1 player (open for joining)
    // Redis keys pattern is usually 'room:<roomId>' or similar; 
    // You might need to store and track open rooms separately or list keys here
    // For simplicity, here we do NOT scan Redis but just create a new room each time
    // To implement room search in Redis, you need extra logic (scan keys etc.)

    // Instead, let's assume client sends roomId to join; if no roomId, create new

    // For demo, create new room always:
    const roomId = uuidv4();

    const player = { id: username, name: username }; // no socketId in REST context

    const initialGameState = {
      players: [player],
      pieces: initialPieces(),
      currentPlayer: 1,
      status: 'waiting', // waiting for opponent
    };

    await createRoom(roomId, player, initialGameState);

    // Optionally save minimal MongoDB metadata if you want
    // (Not mandatory here)

    console.log(`🆕 Redis room created: ${roomId} by ${username}`);

    res.status(201).json({
      message: 'Room created and joined',
      roomId,
      players: initialGameState.players.map(p => p.name),
      playerNumber: 1,
      gameStarted: false,
      pieces: initialGameState.pieces,
      currentPlayer: initialGameState.currentPlayer,
    });
  } catch (err) {
    console.error('Error creating/joining room in Redis:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/game-rooms/join/:roomId
// Join existing Redis room by roomId
router.post('/join/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    let room = await getRoom(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.players.some(p => p.id === username)) {
      return res.json({
        message: 'Already in room',
        roomId,
        players: room.players.map(p => p.name),
        playerNumber: room.players.findIndex(p => p.id === username) + 1,
        gameStarted: room.players.length === 2,
        pieces: room.pieces,
        currentPlayer: room.currentPlayer,
      });
    }

    if (room.players.length >= 2) {
      return res.status(400).json({ error: 'Room is full' });
    }

    const player = { id: username, name: username };
    await addPlayerToRoom(roomId, player);

    room = await getRoom(roomId); // refresh

    console.log(`👤 ${username} joined Redis room ${roomId}`);

    res.json({
      message: 'Joined existing room',
      roomId,
      players: room.players.map(p => p.name),
      playerNumber: room.players.findIndex(p => p.id === username) + 1,
      gameStarted: room.players.length === 2,
      pieces: room.pieces,
      currentPlayer: room.currentPlayer,
    });
  } catch (err) {
    console.error('Error joining Redis room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/game-rooms/state/:roomId
// Get current Redis room state (players, game status, board)
router.get('/state/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await getRoom(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      players: room.players.map(p => p.name),
      gameStarted: room.players.length === 2,
      pieces: room.pieces,
      currentPlayer: room.currentPlayer,
      status: room.status,
    });
  } catch (err) {
    console.error('Error fetching Redis room state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/game-rooms/state/:roomId
// Update game state in Redis (pieces, currentPlayer, status)
router.put('/state/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { pieces, currentPlayer, status } = req.body;

    const room = await getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (pieces) room.pieces = pieces;
    if (currentPlayer !== undefined) room.currentPlayer = currentPlayer;
    if (status) room.status = status;

    await updateGameState(roomId, room);

    res.json({ message: 'Game state updated' });
  } catch (err) {
    console.error('Error updating Redis game state:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/game-rooms/:roomId
// Delete Redis room
router.delete('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await deleteRoom(roomId);

    console.log(`🗑️ Redis room deleted: ${roomId}`);
    res.json({ message: 'Room deleted successfully' });
  } catch (err) {
    console.error('Error deleting Redis room:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

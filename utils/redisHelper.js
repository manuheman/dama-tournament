const Redis = require('ioredis');
const redisClient = new Redis();

const GAME_ROOM_PREFIX = 'dama:room:';
const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function getRoomKey(roomId) {
  return `${GAME_ROOM_PREFIX}${roomId}`;
}

// -----------------
// Create or join a room
// -----------------
async function createOrJoinRoomDama1V1(roomId, userId, betAmount = 0, userName = 'Unknown') {
  const key = getRoomKey(roomId);
  let roomData = await redisClient.get(key);
  let room;

  if (!roomData) {
    // Create new room
    room = {
      roomId,
      creatorId: userId,
      creatorName: userName,
      players: [userId],
      status: 'waiting',
      betAmount,
      createdAt: Date.now(),
      gameState: {
        board: null,
        currentTurn: null,
        colors: {},
        status: 'waiting',
        winner: null
      }
    };

    await redisClient.set(key, JSON.stringify(room));

    // Auto-delete empty room
    setTimeout(async () => {
      const r = await getRoomDama1V1(roomId); // ✅ updated here
      if (r && r.players.length <= 1) {
        await deleteRoomDama1V1(roomId); // ✅ make sure deleteRoomDama1V1 is used
        console.log(`⚠️ Room ${roomId} deleted automatically (empty).`);
      }
    }, EMPTY_ROOM_TIMEOUT);

    console.log(`🎉 Room ${roomId} created by player ${userId}`);
    return { room, created: true };
  } else {
    room = JSON.parse(roomData);

    if (room.players.includes(userId)) return { room, created: false };
    if (room.players.length >= 2) return { error: 'Room full' };

    room.players.push(userId);
    await redisClient.set(key, JSON.stringify(room));
    console.log(`🔹 Player ${userId} joined room ${roomId}`);
    return { room, created: false };
  }
}


// -----------------
// Get room by ID
// -----------------
async function getRoomDama1V1(roomId) {
  const key = getRoomKey(roomId);
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

// -----------------
// Update room info
// -----------------
async function updateRoomDama1V1(roomId, roomData) {
  const key = getRoomKey(roomId);
  await redisClient.set(key, JSON.stringify(roomData));
}

// -----------------
// Delete room
// -----------------
async function deleteRoomDama1V1(roomId) {
  const key = getRoomKey(roomId);
  await redisClient.del(key);
  console.log(`🗑️ Room ${roomId} deleted from Redis`);
}

// -----------------
// Leave a room
// -----------------
async function leaveRoomDama1V1(roomId, userId) {
  const room = await getRoom(roomId);
  if (!room) return { error: 'Room not found' };

  room.players = room.players.filter(p => p !== userId);
  delete room.gameState.colors[userId];

  if (room.players.length === 0) {
    await deleteRoomDama1V1(roomId);
    return { room: null, deleted: true };
  } else {
    room.status = 'waiting';
    if (room.gameState.currentTurn === userId) {
      room.gameState.currentTurn = room.players[0];
    }
    await updateRoom(roomId, room);
    return { room, deleted: false };
  }
}

// -----------------
// Get all rooms
// -----------------
async function getAllRoomsDama1V1() {
  const keys = await redisClient.keys(`${GAME_ROOM_PREFIX}*`);
  const rooms = [];
  for (const key of keys) {
    const data = await redisClient.get(key);
    if (!data) continue;
    const room = JSON.parse(data);
    room.roomId = key.split(':')[2];
    rooms.push(room);
  }
  return rooms;
}

// -----------------
// Initialize board
// -----------------
function initializeBoard(BOARD_SIZE = 8) {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 !== 0 && row < 3) {
        board[row][col] = { player: 2, king: false, color: 'green' };
      }
      if ((row + col) % 2 !== 0 && row > 4) {
        board[row][col] = { player: 1, king: false, color: 'red' };
      }
    }
  }
  return board;
}

// -----------------
// Save game state
// -----------------
// -----------------
// Save game state
// -----------------
async function saveGameState(roomId, gameState) {
  const room = await getRoomDama1V1(roomId);
  if (!room) return { error: 'Room not found' };

  // Initialize board if missing
  if (!gameState.board) gameState.board = initializeBoard();

  // Assign colors if missing
  const [p1, p2] = room.players;
  if (p1 && !gameState.colors[p1]) gameState.colors[p1] = 'red';
  if (p2 && !gameState.colors[p2]) gameState.colors[p2] = 'green';

  // ✅ Preserve currentTurn, don't reset on join/reload
  const validPlayers = Object.keys(gameState.colors);
  if (!gameState.currentTurn || !validPlayers.includes(gameState.currentTurn)) {
    gameState.currentTurn = validPlayers[0]; // only if invalid
  }

  // ✅ Start game automatically if 2 players
  if (room.players.length === 2) {
    gameState.status = 'started';
   room.status = 'full';   // <--- NEW LINE
  } else {
    gameState.status = 'waiting';
    room.status = 'waiting';   // <--- keep room waiting
  }

  room.gameState = gameState;
  await updateRoomDama1V1(roomId, room);
  return { success: true };
}


// -----------------
// Get game state
// -----------------
async function getGameState(roomId) {
  const room = await getRoomDama1V1(roomId);
  return room ? room.gameState : null;
}

// -----------------
// Get valid moves for a piece (including captures)
// -----------------
// -----------------
// Get valid moves for a piece (including captures)
// -----------------
// -----------------
// Get valid moves (normal + captures)
// -----------------
// -----------------
// Get valid moves (normal + captures, Ethiopian rules)
// -----------------
function getValidMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];

  const moves = [];
  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  // -----------------
  // Normal piece moves
  // -----------------
  if (!piece.king) {
    // Movement directions: forward only (cannot move back without capturing)
    const moveDirections = piece.player === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

    for (const [dr, dc] of moveDirections) {
      const newRow = row + dr;
      const newCol = col + dc;
      if (inBounds(newRow, newCol) && !board[newRow][newCol]) {
        moves.push({ from: { row, col }, to: { row: newRow, col: newCol }, capture: null });
      }
    }

    // Capture directions: all diagonals (forward + backward)
    const captureDirections = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of captureDirections) {
      const midRow = row + dr;
      const midCol = col + dc;
      const capRow = row + 2 * dr;
      const capCol = col + 2 * dc;

      if (
        inBounds(midRow, midCol) &&
        inBounds(capRow, capCol) &&
        board[midRow][midCol] &&
        board[midRow][midCol].player !== piece.player &&
        !board[capRow][capCol]
      ) {
        moves.push({
          from: { row, col },
          to: { row: capRow, col: capCol },
          capture: { row: midRow, col: midCol }
        });
      }
    }
  }

  // -----------------
  // King moves
  // -----------------
  if (piece.king) {
    const directions = [[-1,-1],[-1,1],[1,-1],[1,1]];
    for (const [dr, dc] of directions) {
      let r = row + dr, c = col + dc;
      // Slide freely until blocked
      while (inBounds(r, c) && !board[r][c]) {
        moves.push({ from: { row, col }, to: { row: r, col: c }, capture: null });
        r += dr; c += dc;
      }
      // Capture: skip over one enemy piece, then slide
      if (inBounds(r, c) && board[r][c] && board[r][c].player !== piece.player) {
        let capRow = r, capCol = c;
        r += dr; c += dc;
        while (inBounds(r, c) && !board[r][c]) {
          moves.push({
            from: { row, col },
            to: { row: r, col: c },
            capture: { row: capRow, col: capCol }
          });
          r += dr; c += dc;
        }
      }
    }
  }

  // -----------------
  // Mandatory capture rule
  // -----------------
  const captureMoves = moves.filter(m => m.capture);
  return captureMoves.length > 0 ? captureMoves : moves;
}


// -----------------
// Apply move
// -----------------


const OneVOneResult = require('../models/1V1result');
const User = require('../models/user');
async function applyMove(roomId, move, playerId, io = null) {
  console.log(`🔹 Player ${playerId} is attempting a move in room ${roomId}`, move);

  const gameState = await getGameState(roomId);
  if (!gameState) return { success: false, error: 'Game not started' };

  const { from, to, capture } = move;

  // --- Validation ---
  if (!gameState.board[from.row] || !gameState.board[to.row])
    return { success: false, error: 'Move out of board bounds' };

  const piece = gameState.board[from.row][from.col];
  if (!piece) return { success: false, error: 'No piece at source' };

  const playerColor = gameState.colors[playerId];
  if (!playerColor) return { success: false, error: 'Player not in game' };
  if (piece.color !== playerColor) return { success: false, error: 'Invalid piece' };
  if (gameState.currentTurn !== playerId) return { success: false, error: 'Not your turn' };
  if (gameState.board[to.row][to.col] !== null) return { success: false, error: 'Destination occupied' };

  // --- Apply move ---
  gameState.board[to.row][to.col] = piece;
  gameState.board[from.row][from.col] = null;

  // --- Capture ---
  if (capture) {
    const captures = Array.isArray(capture) ? capture : [capture];
    captures.forEach(c => (gameState.board[c.row][c.col] = null));

    // Check if multi-capture is possible
    const moreCaptures = getValidMoves(gameState.board, to.row, to.col).filter(m => m.capture);
    if (moreCaptures.length > 0) {
      gameState.currentTurn = playerId; // same player keeps turn
      await saveGameState(roomId, gameState);
      return { success: true, gameState, multiCapture: true };
    }
  }

  // --- King promotion ---
  if (!piece.king && ((piece.player === 1 && to.row === 0) || (piece.player === 2 && to.row === 7))) {
    piece.king = true;
    console.log(`👑 Player ${playerId}'s piece promoted to King at ${to.row},${to.col}`);
  }

  // --- Switch turn ---
  const opponentId = Object.keys(gameState.colors).find(id => id !== playerId);
  gameState.currentTurn = opponentId;

  // --- Win condition ---
  const opponentPieces = gameState.board.flat().filter(p => p && p.color !== piece.color);
  const opponentMoves = [];
  gameState.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell && cell.color !== piece.color) opponentMoves.push(...getValidMoves(gameState.board, r, c));
    });
  });

  let newBalance = 0;

  if (opponentPieces.length === 0 || opponentMoves.length === 0) {
    gameState.status = 'finished';
    gameState.winner = playerId;
    console.log(`🏆 Player ${playerId} wins!`);

    try {
      const room = await getRoomDama1V1(roomId);
      const stake = room?.betAmount || 0;
      const winningAmount = stake * 2 * 0.9;

      const winner = await User.findOne({ telegram_id: playerId });
      if (winner) {
        winner.oneVsOne_balance = (winner.oneVsOne_balance || 0) + winningAmount;
        await winner.save();
        newBalance = winner.oneVsOne_balance;
      }

      // Save match
      const playerIds = Object.keys(gameState.colors);
      const [p1, p2] = playerIds;
      await OneVOneResult.create({
        roomId,
        player1: { telegramId: p1, result: p1 === playerId ? 'win' : 'lose' },
        player2: { telegramId: p2, result: p2 === playerId ? 'win' : 'lose' },
        winner: playerId,
        totalStake: stake
      });

      // Notify clients
      if (io) {
        io.to(roomId).emit('gameOver', {
          winnerId: playerId,
          message: `🏆 Player ${playerId} wins!`,
          winningAmount,
          newBalance
        });
      }

      // Delete finished game
      await deleteRoomDama1V1(roomId);
    } catch (err) {
      console.error(`❌ Finalizing game failed:`, err);
    }
  } else {
    await saveGameState(roomId, gameState);
  }

  return { success: true, gameState, newBalance };
}

module.exports = {
  
  createOrJoinRoomDama1V1,
  getRoomDama1V1,
  updateRoomDama1V1,
  deleteRoomDama1V1,
  leaveRoomDama1V1,
  getAllRoomsDama1V1,
  saveGameState,
  getGameState,
  applyMove,
  getValidMoves,
  initializeBoard
};

const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Room = require('../models/room');
const OneVOneResults = require('../models/1V1result');
const {
  createOrJoinRoomDama1V1,
  getAllRoomsDama1V1,
  getRoomDama1V1,
  updateRoomDama1V1
} = require('../utils/redisHelper');
const { v4: uuidv4 } = require('uuid');

// -----------------------------
// GET user info by Telegram ID
// -----------------------------
router.get('/user/:telegram_id', async (req, res) => {
  try {
    const telegramId = req.params.telegram_id;
    const user = await User.findOne({ telegram_id: telegramId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      name: user.name || 'Unknown',
      telegram_id: user.telegram_id,
      oneVsOne_balance: user.oneVsOne_balance || 0,
      createdAt: user.createdAt
    });
  } catch (err) {
    console.error('❌ GET /user/:telegram_id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------
// Create a new room
// -----------------------------
router.post('/create', async (req, res) => {
  try {
    const { creatorTelegramId, betAmount, creatorName } = req.body;
    if (!creatorTelegramId || betAmount === undefined) 
      return res.status(400).json({ error: 'Missing fields' });

    const fixtureId = uuidv4();

    const creatorUser = await User.findOne({ telegram_id: creatorTelegramId });
    if (!creatorUser) return res.status(404).json({ error: 'Creator not found' });
    if (creatorUser.oneVsOne_balance < betAmount) return res.status(400).json({ error: 'Insufficient balance' });

    creatorUser.oneVsOne_balance -= betAmount;
    await creatorUser.save();

    const { room, error } = await createOrJoinRoomDama1V1(fixtureId, creatorTelegramId, betAmount, creatorName || creatorUser.name);
    if (error) return res.status(400).json({ error });

    // Update room in Redis
    await updateRoomDama1V1(fixtureId, room);

    // Save room to MongoDB
    await Room.create({
      roomId: fixtureId,
      creatorTelegramId,
      creatorName: creatorName || creatorUser.name,
      betAmount,
      players: [{ telegramId: creatorTelegramId, name: creatorName || creatorUser.name }],
      status: 'waiting'
    });

    console.log(`🎉 Room ${fixtureId} created by player ${creatorTelegramId}`);
    res.json(room);
  } catch (err) {
    console.error('❌ POST /create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------
// Join an existing room
// -----------------------------
router.post('/join', async (req, res) => {
  try {
    const { roomId, userId, userName } = req.body;
    if (!roomId || !userId) return res.status(400).json({ error: 'roomId and userId are required' });

    const { room, error } = await createOrJoinRoomDama1V1(roomId, userId, 0, userName);
    if (error) return res.status(400).json({ error });

    const joinUser = await User.findOne({ telegram_id: userId });
    if (!joinUser) return res.status(404).json({ error: 'User not found' });
    if (joinUser.oneVsOne_balance < (room.betAmount || 0)) return res.status(400).json({ error: 'Insufficient balance' });

    if (room.betAmount > 0) {
      joinUser.oneVsOne_balance -= room.betAmount;
      await joinUser.save();
    }

    const creatorTelegramId = room.players[0];
    const creatorUser = await User.findOne({ telegram_id: creatorTelegramId }).lean();
    room.creatorName = creatorUser ? creatorUser.name : creatorTelegramId;

    if (!room.betAmount) room.betAmount = 0;

    await Room.findOneAndUpdate(
      { roomId },
      { $set: { status: 'ready' }, $addToSet: { players: { telegramId: userId, name: userName || joinUser.name || 'Unknown' } } },
      { new: true }
    );

    await updateRoomDama1V1(roomId, room);

    res.json(room);
  } catch (err) {
    console.error('❌ POST /join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------
// GET all available rooms
// -----------------------------
router.get('/rooms', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId query param is required' });

    const rooms = await getAllRoomsDama1V1();
    const relevantRooms = rooms.filter(r =>
      (Array.isArray(r.players) && r.players.includes(userId)) || r.players.length === 1
    );

    const enhancedRooms = await Promise.all(
      relevantRooms.map(async r => {
        let creatorName = r.creatorName;
        let betAmount = r.betAmount || 0;
        try {
          const dbRoom = await Room.findOne({ roomId: r.roomId }).lean();
          if (dbRoom) {
            creatorName = dbRoom.creatorName;
            betAmount = dbRoom.betAmount;
            r.status = dbRoom.status || r.status;
          }
        } catch (err) {
          console.warn('Failed to fetch room from DB:', err);
        }
        return { ...r, creatorName, betAmount };
      })
    );

    res.json(enhancedRooms);
  } catch (err) {
    console.error('❌ GET /rooms error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -----------------------------
// GET all finished games (History)
// -----------------------------
router.get('/history/all', async (req, res) => {
  try {
    const games = await OneVOneResults.find().sort({ createdAt: -1 }).lean();
    const formatted = games.map(g => {
      let winnerName = 'Draw';
      if (g.winner) {
        if (g.player1.telegramId === g.winner) winnerName = g.player1.name;
        else if (g.player2.telegramId === g.winner) winnerName = g.player2.name;
        else winnerName = g.winner;
      }
      return {
        roomId: g.roomId,
        players: [g.player1.name, g.player2.name],
        winner: winnerName,
        totalStake: g.totalStake
      };
    });
    res.json(formatted);
  } catch (err) {
    console.error('❌ GET /history/all error:', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// -----------------------------
// GET player-specific finished games (My History)
// -----------------------------
router.get('/history/my/:telegramId', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const games = await OneVOneResults.find({
      $or: [{ 'player1.telegramId': telegramId }, { 'player2.telegramId': telegramId }]
    }).sort({ createdAt: -1 }).lean();

    const formatted = games.map(g => {
      const player = g.player1.telegramId === telegramId ? g.player1 : g.player2;
      const opponent = g.player1.telegramId === telegramId ? g.player2 : g.player1;
      return {
        roomId: g.roomId,
        players: [player.name, opponent.name],
        result: player.result,
        stake: player.stake,
        opponentName: opponent.name
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('❌ GET /history/my/:telegramId error:', err);
    res.status(500).json({ error: 'Failed to fetch my history' });
  }
});

module.exports = router;

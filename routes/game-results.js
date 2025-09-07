const express = require('express');
const router = express.Router();
const GameResult = require('../models/Gameresult');
const User = require('../models/user'); // for populating player info

// GET all game results with populated player info
router.get('/', async (req, res) => {
  try {
    const results = await GameResult.find()
      .sort({ playedAt: -1 })
      .populate('player1', 'telegram_id telegram_username name')  // fields to populate
      .populate('player2', 'telegram_id telegram_username name')
      .lean();

    const transformed = results.map((result) => {
      let winnerTelegramId = 'Draw';
      let winnerName = 'Draw';

      if (result.winner === 1) {
        winnerTelegramId = result.player1TelegramId || (result.player1 && result.player1.telegram_id);
        winnerName = (result.player1 && result.player1.name) || winnerTelegramId;
      } else if (result.winner === 2) {
        winnerTelegramId = result.player2TelegramId || (result.player2 && result.player2.telegram_id);
        winnerName = (result.player2 && result.player2.name) || winnerTelegramId;
      }

      const opponentTelegramId =
        result.winner === 1
          ? result.player2TelegramId || (result.player2 && result.player2.telegram_id)
          : result.player1TelegramId || (result.player1 && result.player1.telegram_id);

      const opponentName =
        result.winner === 1
          ? (result.player2 && result.player2.name) || opponentTelegramId
          : (result.player1 && result.player1.name) || opponentTelegramId;

      return {
        id: result._id,
        tournamentUniqueId: result.tournamentUniqueId,
        roomId: result.roomId,
        winner: winnerName,
        winnerTelegramId,
        opponent: opponentName,
        opponentTelegramId,
        score: 'N/A', // update this if you store scores
        finalBoard: result.finalBoard,
        playedAt: result.playedAt.toISOString(),
      };
    });

    res.json(transformed);
  } catch (err) {
    console.error('Error fetching game results:', err);
    res.status(500).json({ error: 'Failed to fetch game results' });
  }
});

// POST to create/save a new game result
router.post('/', async (req, res) => {
  const {
    roomId,
    player1,            // ObjectId string (required)
    player1TelegramId,  // string (required)
    player2,            // ObjectId string (optional for bye)
    player2TelegramId,  // string (optional for bye)
    winner,             // number: 0=draw, 1=player1, 2=player2
    finalBoard,
    tournamentUniqueId, // string (required)
  } = req.body;

  // Validation
  if (
    !roomId ||
    !player1 ||
    !player1TelegramId ||
    (winner !== 0 && !player2) ||  // if winner is 1 or 2, player2 is required
    !tournamentUniqueId
  ) {
    return res.status(400).json({ error: 'Missing required fields or invalid winner/player2 combination' });
  }

  try {
    const newResult = new GameResult({
      roomId,
      player1,
      player1TelegramId,
      player2: player2 || null,
      player2TelegramId: player2TelegramId || null,
      winner,
      finalBoard,
      tournamentUniqueId,
    });

    await newResult.save();

    res.status(201).json({ message: 'Game result saved', id: newResult._id });
  } catch (err) {
    console.error('Error saving game result:', err);
    res.status(500).json({ error: 'Failed to save game result' });
  }
});

// PUT to update an existing game result by ID
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    tournamentUniqueId,
    winner,
    playedAt,
    finalBoard,
  } = req.body;

  try {
    const existing = await GameResult.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Game result not found' });
    }

    if (tournamentUniqueId) existing.tournamentUniqueId = tournamentUniqueId;
    if (typeof winner === 'number') existing.winner = winner;
    if (playedAt) existing.playedAt = new Date(playedAt);
    if (finalBoard) existing.finalBoard = finalBoard;

    await existing.save();

    res.json({ message: 'Game result updated', id: existing._id });
  } catch (err) {
    console.error('Error updating game result:', err);
    res.status(500).json({ error: 'Failed to update game result' });
  }
});

// DELETE a game result by ID
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await GameResult.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Game result not found' });
    }
    res.json({ message: 'Game result deleted successfully', id });
  } catch (err) {
    console.error('Error deleting game result:', err);
    res.status(500).json({ error: 'Failed to delete game result' });
  }
});

module.exports = router;

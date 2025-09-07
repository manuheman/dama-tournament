const express = require('express');
const router = express.Router();
const GameResult = require('../models/Gameresult');

// GET all game results (newest first)
router.get('/results', async (req, res) => {
  try {
    const results = await GameResult.find().sort({ playedAt: -1 }).lean();
    res.json({ results });
  } catch (err) {
    console.error('Error fetching game results:', err);
    res.status(500).json({ error: 'Failed to fetch game results' });
  }
});

// GET results for a specific user by userId (telegramId)
router.get('/user/:userId/results', async (req, res) => {
  const userId = req.params.userId;
  try {
    const results = await GameResult.find({
      $or: [{ player1: userId }, { player2: userId }],
    })
      .sort({ playedAt: -1 })
      .lean();
    res.json({ results });
  } catch (err) {
    console.error(`Error fetching results for user ${userId}:`, err);
    res.status(500).json({ error: 'Failed to fetch user results' });
  }
});

// POST new game result
router.post('/results', async (req, res) => {
  const { roomId, player1, player2, winner, finalBoard, tournamentUniqueId, playedAt } = req.body;

  if (
    !roomId ||
    !player1 ||
    !player2 ||
    typeof winner !== 'number' ||
    !tournamentUniqueId
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const newResult = new GameResult({
      roomId,
      player1,
      player2,
      winner,
      finalBoard,
      tournamentUniqueId,
      playedAt: playedAt ? new Date(playedAt) : new Date(),
    });

    await newResult.save();

    res.status(201).json({ message: 'Game result saved', id: newResult._id });
  } catch (err) {
    console.error('Error saving game result:', err);
    res.status(500).json({ error: 'Failed to save game result' });
  }
});

// PUT update existing game result by ID
router.put('/results/:id', async (req, res) => {
  const { id } = req.params;
  const { tournamentUniqueId, winner, playedAt } = req.body;

  try {
    const existing = await GameResult.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Game result not found' });
    }

    if (tournamentUniqueId) existing.tournamentUniqueId = tournamentUniqueId;

    if (winner !== undefined) {
      // Expect winner as either 0(draw), 1(player1), 2(player2)
      if ([0,1,2].includes(winner)) {
        existing.winner = winner;
      } else {
        return res.status(400).json({ error: 'Invalid winner value' });
      }
    }

    if (playedAt) existing.playedAt = new Date(playedAt);

    await existing.save();

    res.json({ message: 'Game result updated', id: existing._id });
  } catch (err) {
    console.error('Error updating game result:', err);
    res.status(500).json({ error: 'Failed to update game result' });
  }
});

// DELETE game result by ID
router.delete('/results/:id', async (req, res) => {
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

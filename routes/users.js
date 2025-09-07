const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Tournament = require('../models/tournament');
const Fixture = require('../models/fixture');

// ✅ Get all users (optional for listing, can keep or remove)
router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// ✅ Delete user by ID (optional for cleanup, can keep or remove)
router.delete('/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

router.get('/:telegramId/fixtures', async (req, res) => {
  try {
    const { telegramId } = req.params;

    if (!telegramId) {
      return res.status(400).json({ message: 'telegramId is required' });
    }

    // Find user by Telegram ID
    const user = await User.findOne({ telegram_id: telegramId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Find tournaments where the user is a player
    const tournaments = await Tournament.find({ players: user._id });

    if (!tournaments.length) {
      return res.status(404).json({ message: 'User is not part of any tournament' });
    }

    // Get all tournament IDs user participates in
    const tournamentIds = tournaments.map(t => t._id);

    // Find fixtures in all these tournaments
    const fixtures = await Fixture.find({ tournament: { $in: tournamentIds } })
      .populate('player1', 'name telegram_id')
      .populate('player2', 'name telegram_id')
      .populate('tournament', 'uniqueId type balance') // Also populate tournament info for each fixture
      .sort({ createdAt: 1 });

    // Format fixtures with status included
    const formattedFixtures = fixtures.map((fx, idx) => {
      const isUserInFixture =
        (fx.player1 && fx.player1.telegram_id === telegramId) ||
        (fx.player2 && fx.player2.telegram_id === telegramId);

      return {
        matchNumber: idx + 1,
        fixtureId: fx._id,
        player1: fx.player1 ? fx.player1.name : 'N/A',
        player2: fx.player2 ? fx.player2.name : 'BYE',
        result: fx.result || '',
        status: fx.status || 'pending',
        matchTime: fx.matchTime || null,
        roomId: fx.roomId || null,
        userCanPlay: isUserInFixture && !!fx.roomId,
        tournament: fx.tournament ? {
          uniqueId: fx.tournament.uniqueId,
          type: fx.tournament.type,
          balance: fx.tournament.balance,
        } : null,
      };
    });

    // Optionally, send back user info and the list of tournaments
    return res.json({
      user: { name: user.name },
      tournaments: tournaments.map(t => ({
        uniqueId: t.uniqueId,
        type: t.type,
        balance: t.balance,
      })),
      fixtures: formattedFixtures,
    });
  } catch (err) {
    console.error('Error fetching fixtures:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
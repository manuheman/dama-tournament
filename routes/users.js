const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Tournament = require('../models/tournament');
const Fixture = require('../models/fixture');

// ✅ Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// ✅ Update balance by Telegram ID
// ✅ Update user balance by telegram_id
router.put('/:telegramId/balance', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { change } = req.body; // positive or negative number

    if (!change || isNaN(change)) {
      return res.status(400).json({ message: 'Invalid balance change value' });
    }

    // Find user by telegram_id
    const user = await User.findOne({ telegram_id: telegramId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update balance
    user.oneVsOne_balance = (user.oneVsOne_balance || 0) + change;
    await user.save();

    res.json({
      message: 'Balance updated successfully',
      balance: user.oneVsOne_balance
    });
  } catch (err) {
    console.error('Error updating balance:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// ✅ Delete user by Telegram ID
router.delete('/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const user = await User.findOneAndDelete({ telegram_id: telegramId });

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Error deleting user' });
  }
});

// ✅ Get fixtures for a user by Telegram ID
router.get('/:telegramId/fixtures', async (req, res) => {
  try {
    const { telegramId } = req.params;

    if (!telegramId) {
      return res.status(400).json({ message: 'telegramId is required' });
    }

    const user = await User.findOne({ telegram_id: telegramId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const tournaments = await Tournament.find({ players: user._id });
    if (!tournaments.length) {
      return res.status(404).json({ message: 'User is not part of any tournament' });
    }

    const tournamentIds = tournaments.map(t => t._id);
    const fixtures = await Fixture.find({ tournament: { $in: tournamentIds } })
      .populate('player1', 'name telegram_id')
      .populate('player2', 'name telegram_id')
      .populate('tournament', 'uniqueId type balance')
      .sort({ createdAt: 1 });

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

    res.json({
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
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

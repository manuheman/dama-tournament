const express = require('express');
const router = express.Router();
const Tournament = require('../models/tournament');
const Fixture = require('../models/fixture');

// Admin: Get all tournaments
router.get('/', async (req, res) => {
  try {
    const tournaments = await Tournament.find().populate('players');
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching tournaments' });
  }
});

// Admin: Delete tournament by id (also delete related fixtures)
router.delete('/:id', async (req, res) => {
  try {
    const tournamentId = req.params.id;
    await Fixture.deleteMany({ tournament: tournamentId });
    await Tournament.findByIdAndDelete(tournamentId);
    res.json({ message: 'Tournament and related fixtures deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting tournament' });
  }
});

// Admin: Assign uniqueId to tournament
router.post('/:id/assign-id', async (req, res) => {
  try {
    const { uniqueId } = req.body;
    const tournamentId = req.params.id;
    if (!uniqueId) return res.status(400).json({ message: 'Unique ID is required' });

    const existing = await Tournament.findOne({ uniqueId });
    if (existing) return res.status(400).json({ message: 'Unique ID already exists. Please choose a different ID.' });

    const tournament = await Tournament.findByIdAndUpdate(
      tournamentId,
      { uniqueId },
      { new: true }
    );
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });

    res.json({ message: 'Unique ID assigned successfully', tournament });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error assigning unique ID' });
  }
});

module.exports = router;

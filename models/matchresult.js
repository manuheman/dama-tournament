const mongoose = require('mongoose');

const matchResultSchema = new mongoose.Schema({
  tournamentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tournament',
    required: true,
  },
  fixtureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fixture',
    required: true,
  },
  winnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  loserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  score: {
    type: String, // optional: e.g. "3-1", or "5-4"
    default: null,
  },
  resultDate: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
  },
});

module.exports = mongoose.model('MatchResult', matchResultSchema);

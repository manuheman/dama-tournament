const mongoose = require('mongoose');

const FixtureSchema = new mongoose.Schema({
  tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    player1JoinTime: { type: Date, default: null }, // <--- new field
    player2JoinTime: { type: Date, default: null }, // <--- new fiel
  matchTime: { type: Date, default: null },
  reminderSent: {
    type: Boolean,
    default: false
  },
  
  disabled: {
    type: Boolean,
    default: false,
  },
  
  result: {
    type: Number,
    enum: [0, 1, 2, 3],  // 0 = pending, 1 = player1 wins, 2 = player2 wins, 3 = draw
    default: 0
  },
  
  
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'in_progress', 'completed', 'waiting'],
    default: 'pending'
  },
  startTime: { type: Date, default: null },
  
  round: { // NEW: track which round this fixture belongs to
    type: Number,
    required: true,
    default: 1,
  },

  createdAt: { type: Date, default: Date.now },
});

FixtureSchema.index({ tournament: 1, round: 1 });

module.exports = mongoose.model('Fixture', FixtureSchema);

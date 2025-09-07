const mongoose = require('mongoose');

const gameResultSchema = new mongoose.Schema({
  roomId: { type: String },

  player1: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  player1TelegramId: { 
    type: String,
    required: true
  },

  player2: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  player2TelegramId: { 
    type: String,
  },

  winner: { type: Number, enum: [0, 1, 2], default: 0 }, // 0=draw, 1=player1, 2=player2

  finalBoard: Array,

  tournamentUniqueId: { type: String, required: true },

  playedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.GameResult || mongoose.model('GameResult', gameResultSchema);

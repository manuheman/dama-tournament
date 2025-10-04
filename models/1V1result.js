// models/1V1Results.js
const mongoose = require('mongoose');

const OneVOneResultSchema = new mongoose.Schema({
  roomId: { type: String, required: true }, // the room/game identifier

  player1: {
    telegramId: { type: String, required: true },
    name: { type: String, default: 'Unknown' },
    stake: { type: Number, default: 0 },
    result: { type: String, enum: ['win', 'lose', 'draw'], required: true }
  },

  player2: {
    telegramId: { type: String, required: true },
    name: { type: String, default: 'Unknown' },
    stake: { type: Number, default: 0 },
    result: { type: String, enum: ['win', 'lose', 'draw'], required: true }
  },

  winner: { type: String, default: null }, // telegramId of the winner; null for draw
  totalStake: { type: Number, required: true },

  status: { 
    type: String, 
    enum: ['waiting', 'started', 'finished'], 
    default: 'finished' 
  },

  createdAt: { type: Date, default: Date.now }
});

// Optional: Index to quickly query by roomId
OneVOneResultSchema.index({ roomId: 1 });

module.exports = mongoose.model('1V1Results', OneVOneResultSchema);

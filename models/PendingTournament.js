const mongoose = require('mongoose');

const PendingTournamentSchema = new mongoose.Schema({
  txRef: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  balance: { type: Number, required: true },
  maxPlayers: { type: Number, default: 4 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PendingTournament', PendingTournamentSchema);

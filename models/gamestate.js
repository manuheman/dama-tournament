// Example MongoDB schema (using Mongoose)
const mongoose = require('mongoose');

const gameStateSchema = new mongoose.Schema({
  fixtureId: { type: String, unique: true },
  board: { type: Array, required: true }, // 2D board array with piece info
  currentPlayer: { type: Number, required: true }, // 1 or 2
  // Add other info as needed, e.g. player names, timestamp
  lastUpdated: { type: Date, default: Date.now },
});

const GameState = mongoose.model('GameState', gameStateSchema);
module.exports = GameState;

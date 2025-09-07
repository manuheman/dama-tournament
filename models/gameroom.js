const mongoose = require('mongoose');

const MAX_PLAYERS = 2;

const gameRoomSchema = new mongoose.Schema({
  fixtureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fixture',
    required: true,
    unique: true
  },
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  players: [
    {
      type: String, // store username or userId
      required: true,
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

gameRoomSchema.methods.isFull = function () {
  return this.players.length >= MAX_PLAYERS;
};

module.exports = mongoose.model('GameRoom', gameRoomSchema);

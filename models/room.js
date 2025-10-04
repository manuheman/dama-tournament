const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  creatorTelegramId: { type: String, required: true },
  creatorName: { type: String, required: true },
  betAmount: { type: Number, required: true },
  players: [{ telegramId: String, name: String }],
  status: { type: String, enum: ['waiting', 'full', 'finished'], default: 'waiting' }
}, { timestamps: true });

module.exports = mongoose.model('Room', RoomSchema);

const mongoose = require('mongoose');

// Utility to generate unique tournament code
function generateUniqueId() {
  return 'TOUR-' + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Map default balances and maxPlayers per type
const TournamentDefaults = {
  Silver: { balance: 50, maxPlayers: 8 },
  Gold: { balance: 100, maxPlayers: 32 },
  Platinum: { balance: 200, maxPlayers: 64 }
};

const TournamentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Silver', 'Gold', 'Platinum'],
    required: true,
  },
  balance: {
    type: Number,
    required: true,
  },
  maxPlayers: {
    type: Number,
    required: true,
  },
  players: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['open', 'full', 'finished'],
    default: 'open',
  },
  fixtures: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Fixture' }],
  uniqueId: {
    type: String,
    unique: true,
    sparse: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

// Pre-save middleware to set defaults and generate uniqueId
TournamentSchema.pre('save', async function (next) {
  // Set default balance and maxPlayers if not set
  if (!this.balance || !this.maxPlayers) {
    const defaults = TournamentDefaults[this.type];
    if (defaults) {
      if (!this.balance) this.balance = defaults.balance;
      if (!this.maxPlayers) this.maxPlayers = defaults.maxPlayers;
    }
  }

  // Generate uniqueId if not set
  if (!this.uniqueId) {
    let newId;
    let exists = true;

    while (exists) {
      newId = generateUniqueId();
      exists = await mongoose.models.Tournament.exists({ uniqueId: newId });
    }

    this.uniqueId = newId;
  }

  next();
});

module.exports = mongoose.model('Tournament', TournamentSchema);

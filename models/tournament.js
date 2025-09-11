const mongoose = require('mongoose');

// Utility to generate unique tournament code
function generateUniqueId() {
  return 'TOUR-' + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Default balances and maxPlayers per type
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
  fixtures: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fixture'
  }],
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

// Pre-validate middleware to set defaults
TournamentSchema.pre('validate', function(next) {
  const defaults = TournamentDefaults[this.type];
  if (defaults) {
    if (!this.balance) this.balance = defaults.balance;
    if (!this.maxPlayers) this.maxPlayers = defaults.maxPlayers;
  }
  next();
});

// Pre-save middleware to generate uniqueId
TournamentSchema.pre('save', async function(next) {
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

// Add a player safely
TournamentSchema.methods.addPlayer = async function(userId) {
  if (!this.players.includes(userId) && this.players.length < this.maxPlayers) {
    this.players.push(userId);
    // Update status if full
    if (this.players.length >= this.maxPlayers) this.status = 'full';
    await this.save();
    return true;
  }
  return false;
};

module.exports = mongoose.model('Tournament', TournamentSchema);

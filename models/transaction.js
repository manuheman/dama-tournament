const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    tx_ref: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['chapa'], default: 'chapa' },
    direction: { type: String, enum: ['deposit', 'withdraw'], default: 'deposit' },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', TransactionSchema);

// Helpful indexes
TransactionSchema.index({ userId: 1, createdAt: -1 });

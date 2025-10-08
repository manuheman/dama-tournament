const mongoose = require('mongoose');

const WithdrawSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  phone: { type: String, required: true },
  channel: { type: String, enum: ['MOBILE_MONEY', 'BANK'], default: 'MOBILE_MONEY' },
  wallet: { type: String }, // e.g., TELEBIRR, CBE_BIRR, MPESA
  status: { type: String, required: true, enum: ['pending', 'success', 'failed'], default: 'pending' },
  tx_ref: { type: String, required: true, unique: true, index: true },
  provider: { type: String, default: 'chapa' },
  provider_ref: { type: String },
  meta: { type: Object, default: {} },
  processedAt: { type: Date },
  failureReason: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Withdraw', WithdrawSchema);

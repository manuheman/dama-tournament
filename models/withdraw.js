const mongoose = require('mongoose');

const WithdrawSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  phone: { type: String, required: true },
  status: { type: String, required: true, default: 'pending' },
  tx_ref: { type: String, required: true }, // <-- make required
}, { timestamps: true });

module.exports = mongoose.model('Withdraw', WithdrawSchema);

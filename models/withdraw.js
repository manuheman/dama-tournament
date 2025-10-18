const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['Telebirr', 'mpesa', 'cbe'], required: true },
  phone: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'success', 'failed'], default: 'pending' },
  reference: { type: String },
  providerTxnId: { type: String },
  responseData: { type: mongoose.Schema.Types.Mixed },
  webhookData: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  telegram_id: { type: String, required: true, unique: true },
  telegram_username: { type: String },
  phone_number: { type: String, required: true },
  language: { type: String, enum: ['EN', 'AM'], default: 'EN' },
    chapaRecipientId: String,  // <-- add this
  oneVsOne_balance: { type: Number, default: 0 } // Added 1v1 balance
}, { timestamps: true }); // optional: adds createdAt and updatedAt

module.exports = mongoose.model('User', UserSchema);

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  telegram_id: { type: String, required: true, unique: true },
  telegram_username: { type: String },
  phone_number: { type: String, required: true }
});

module.exports = mongoose.model('User', UserSchema);

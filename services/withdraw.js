const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/user');
const Withdraw = require('../models/withdraw');

const CHAPA_MODE = process.env.CHAPA_MODE || 'test';
const CHAPA_SECRET_KEY = CHAPA_MODE === 'live'
  ? process.env.CHAPA_SECRET_KEY
  : (process.env.CHAPA_TEST_SECRET_KEY || process.env.CHAPA_SECRET_KEY);
const CHAPA_AUTH_KEY = CHAPA_SECRET_KEY; // Use SECRET for server-to-server calls
const CHAPA_DEBUG = process.env.CHAPA_DEBUG === '1' || process.env.CHAPA_DEBUG === 'true';
const PORT = process.env.PORT || 3000;

function baseUrl() {
  return process.env.NGROK_URL || `http://localhost:${PORT}`;
}

function normalizePhone(phone) {
  phone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  // Accept 09xxxxxxxx / 07xxxxxxxx / +2519xxxxxxxx / +2517xxxxxxxx / 2519xxxxxxxx / 2517xxxxxxxx
  if (/^(\+251|0)?[79]\d{8}$/.test(phone)) {
    if (phone.startsWith('0')) return '+251' + phone.slice(1);
    if (phone.startsWith('9') || phone.startsWith('7')) return '+251' + phone;
    return phone;
  }
  if (/^251[79]\d{8}$/.test(phone)) return '+' + phone;
  if (/^\+251[79]\d{8}$/.test(phone)) return phone;
  throw new Error('Invalid phone number');
}

async function reserveAndCreate({ chatId, amount, phone, wallet, channel }) {
  if (!chatId || !amount || !phone) throw new Error('Missing parameters');
  const user = await User.findOne({ telegram_id: String(chatId) });
  if (!user) throw new Error('User not found');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 5) throw new Error('Minimum withdrawal is 5 ETB');
  if (amt > (user.oneVsOne_balance || 0)) throw new Error('Insufficient balance');

  const normalizedPhone = normalizePhone(phone);

  // Reserve funds atomically
  const updated = await User.findOneAndUpdate(
    { _id: user._id, oneVsOne_balance: { $gte: amt } },
    { $inc: { oneVsOne_balance: -amt, oneVsOne_hold: amt } },
    { new: true }
  );
  if (!updated) throw new Error('Insufficient balance');

  const tx_ref = `wd${user.telegram_id}${Date.now()}`;
  const wd = await Withdraw.create({
    userId: user._id,
    amount: amt,
    phone: normalizedPhone,
    channel: channel || 'MOBILE_MONEY',
    wallet: wallet || 'TELEBIRR',
    status: 'pending',
    tx_ref,
    provider: 'chapa',
  });
  return { user: updated, withdraw: wd };
}

async function requestPayout({ withdraw, chatId }) {
  if (CHAPA_MODE === 'live' && /TEST/i.test(CHAPA_AUTH_KEY || '')) {
    throw new Error('Chapa live mode: a TEST secret key is set. Replace with your LIVE secret (starts with CHASECK-)');
  }
  // Map wallets to Chapa bank_code IDs for mobile money
  const BANK_CODES = { TELEBIRR: 855, CBE_BIRR: 128, MPESA: 266 };
  const wallet = (withdraw.wallet || 'TELEBIRR').toUpperCase();
  const bankCode = BANK_CODES[wallet];
  if (!bankCode) throw new Error(`Unsupported wallet: ${wallet}`);

  // Convert +2517/9xxxxxxxx to local 10-digit 07/09xxxxxxxx for account_number
  const toLocal10 = (p) => {
    const digits = String(p).replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) return digits;
    if (digits.startsWith('251') && digits.length === 12) return '0' + digits.slice(3);
    if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('9'))) return '0' + digits; // safety
    // Fallback: if +251 format already normalized earlier, try last 9 -> add 0
    if (digits.length >= 12 && digits.includes('251')) return '0' + digits.slice(-9);
    throw new Error('Invalid account number/phone format');
  };

  const account_number = toLocal10(withdraw.phone);
  const user = await User.findById(withdraw.userId).lean();
  const account_name = user?.name || 'Wallet User';

  const payload = {
    account_name,
    account_number,
    amount: withdraw.amount,
    currency: 'ETB',
    reference: withdraw.tx_ref,
    bank_code: String(bankCode),
    callback_url: `${baseUrl()}/api/withdraw/callback?chatId=${encodeURIComponent(chatId)}&tx_ref=${encodeURIComponent(withdraw.tx_ref)}`,
  };
  if (CHAPA_DEBUG) {
    const obf = (k) => (k ? `${String(k).slice(0, 8)}...${String(k).slice(-4)}` : 'unset');
    console.log('[Chapa Debug] requestPayout', { mode: CHAPA_MODE, authKey: obf(CHAPA_AUTH_KEY), bank_code: payload.bank_code, account_number });
  }
  const res = await axios.post('https://api.chapa.co/v1/transfers', payload, {
    headers: { Authorization: `Bearer ${CHAPA_AUTH_KEY}` },
  });
  return res.data;
}

async function finalize({ tx_ref, ok, failureReason }) {
  const wd = await Withdraw.findOne({ tx_ref }).populate('userId');
  if (!wd) throw new Error('Withdraw not found');
  if (wd.status !== 'pending') return wd; // idempotent

  const user = await User.findById(wd.userId);
  if (!user) throw new Error('User not found');

  if (ok) {
    wd.status = 'success';
    wd.processedAt = new Date();
    await wd.save();
    // release hold
    await User.updateOne({ _id: user._id, oneVsOne_hold: { $gte: wd.amount } }, { $inc: { oneVsOne_hold: -wd.amount } });
  } else {
    wd.status = 'failed';
    wd.failureReason = failureReason || 'unknown';
    wd.processedAt = new Date();
    await wd.save();
    // refund hold
    await User.updateOne({ _id: user._id, oneVsOne_hold: { $gte: wd.amount } }, { $inc: { oneVsOne_hold: -wd.amount, oneVsOne_balance: wd.amount } });
  }
  return wd;
}

module.exports = { reserveAndCreate, requestPayout, finalize };

// server/routes/withdraw.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Withdraw = require('../models/withdraw');
const User = require('../models/user');

const CHAPA_API_KEY = process.env.CHAPA_API_KEY;
const NGROK_URL = process.env.NGROK_URL;

// ----- Phone normalization -----
function normalizePhone(phone) {
  phone = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (/^(\+251|0)?9\d{8}$/.test(phone)) {
    if (phone.startsWith('0')) return '+251' + phone.slice(1);
    if (phone.startsWith('9')) return '+251' + phone;
    return phone;
  }
  if (/^2519\d{8}$/.test(phone)) return '+' + phone;
  if (/^\+2519\d{8}$/.test(phone)) return phone;
  throw new Error('Invalid phone number');
}

// ----- POST /api/withdraw -----
router.post('/', async (req, res) => {
  try {
    const { chatId, amount, phone } = req.body;

    if (!chatId || !amount || !phone) {
      return res.status(400).json({ error: 'Missing parameters: chatId, amount, phone required' });
    }

    const user = await User.findOne({ telegram_id: chatId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (amount < 5) return res.status(400).json({ error: 'Minimum withdrawal is 5 ETB' });
    if (amount > user.oneVsOne_balance) return res.status(400).json({ error: 'Insufficient balance' });

    const normalizedPhone = normalizePhone(phone);

    // ----- Create Withdraw record -----
    const withdraw = await Withdraw.create({
      userId: user.telegram_id,
      amount,
      phone: normalizedPhone,
      status: 'pending',
      tx_ref: `wd${user.telegram_id}${Date.now()}`
    });

    console.log(`[Withdraw API] Created withdraw record: ${withdraw.tx_ref}`);

    // ----- Chapa Telebirr transfer -----
    const payload = {
      amount,
      currency: 'ETB',
      channel: 'MOBILE_MONEY',
      mobile_money_type: 'TELEBIRR',
      recipient_name: user.name,
      recipient_phone: normalizedPhone,
      reference: withdraw.tx_ref,
      callback_url: `${NGROK_URL}/api/chapa-withdraw-callback?chatId=${chatId}&amount=${amount}`
    };

    console.log('[Withdraw API] Sending transfer request to Chapa...', payload);

    const response = await axios.post('https://api.chapa.co/v1/transfers', payload, {
      headers: { Authorization: `Bearer ${CHAPA_API_KEY}` }
    });

    console.log('[Withdraw API] Chapa response:', response.data);

    // ----- Update withdraw & user balance if immediate success -----
    if (response.data && response.data.status === 'success') {
      withdraw.status = 'success';
      await withdraw.save();

      user.oneVsOne_balance -= amount;
      await user.save();

      console.log(`[Withdraw API] Withdrawal successful, updated balance: ${user.oneVsOne_balance}`);
    }

    res.json({
      message: 'Withdrawal request processed',
      withdrawStatus: withdraw.status,
      chapaResponse: response.data
    });

  } catch (err) {
    console.error('[Withdraw API] Error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to process withdrawal',
      details: err.response?.data || err.message
    });
  }
});

module.exports = router;

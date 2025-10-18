const axios = require('axios');
require('dotenv').config();
const User = require('../models/user');

// ✅ API Key
const ARIFPAY_API_KEY = process.env.ARIFPAY_API_KEY;

// In-memory map: sessionId => telegram_id
// You can later persist this in DB if needed for reliability
const sessionUserMap = new Map();

/**
 * Format Ethiopian phone numbers into ArifPay/Telebirr format: 2519XXXXXXXX
 */
function formatPhone(phone) {
  if (!phone) throw new Error("Phone number is required");
  phone = phone.toString().replace(/\s+/g, '').replace(/^\+/, '');
  if (/^0\d{9}$/.test(phone)) return '251' + phone.slice(1);
  if (/^2519\d{8}$/.test(phone)) return phone;
  throw new Error("❌ Invalid phone number: must be 09XXXXXXXX or 2519XXXXXXXX format");
}

/**
 * Create a Telebirr USSD payment session through ArifPay
 * @param {number} amount - Amount to deposit
 * @param {string} telegram_id - Telegram ID of the user
 * @param {string} phone - Phone number to pay from
 */
async function createArifPayPayment(amount, telegram_id, phone) {
  try {
    if (!telegram_id) throw new Error('Telegram ID is required');

    // Fetch user from DB
    const user = await User.findOne({ telegram_id });
    if (!user) throw new Error(`No user found with telegram_id ${telegram_id}`);

    const formattedPhone = formatPhone(phone);
    const callbackUrl = `${process.env.NGROK_URL}/api/deposit/webhook`;

    console.log('[ArifPay] Creating payment session for', user.name, 'Telegram ID:', telegram_id);

    const payload = {
      cancelUrl: "https://ethiodama.ddnsgeek.com/payment-cancel",
      phone: formattedPhone,
      email: user.email || 'payments@ethiodama.ddnsgeek.com',
      nonce: Math.random().toString(36).substring(2),
      errorUrl: "https://ethiodama.ddnsgeek.com/payment-error",
      notifyUrl: callbackUrl,
      successUrl: "https://ethiodama.ddnsgeek.com/payment-success",
      paymentMethods: ["TELEBIRR_USSD"],
      expiredDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      items: [
        {
          name: "Deposit to EthioDama",
          quantity: 1,
          price: Number(amount),
          description: "Deposit for 1v1 balance",
          image: ""
        }
      ],
      beneficiaries: [
        {
          accountNumber: "01320811436100",
          bank: "AWINETAA",
          amount: Number(amount)
        }
      ],
      lang: "EN"
    };

    const res = await axios.post(
      "https://gateway.arifpay.net/api/checkout/telebirr-ussd/transfer/direct",
      payload,
      { headers: { 'x-arifpay-key': ARIFPAY_API_KEY } }
    );

    const data = res.data?.data;

    if (!data?.sessionId) {
      console.error('[ArifPay] ❌ Invalid response:', res.data);
      return { success: false, message: 'Invalid response from ArifPay' };
    }

    // ✅ Store sessionId → telegram_id mapping
    sessionUserMap.set(data.sessionId, telegram_id);

    console.log(`[ArifPay] Payment session created. Session ID: ${data.sessionId}`);
    return {
      success: true,
      sessionId: data.sessionId,
      paymentUrl: data.paymentUrl || null,
      message: '✅ Payment session created. Complete the payment on your phone.'
    };

  } catch (err) {
    console.error('[ArifPay] Error creating payment:', err.response?.data || err.message || err);
    return { success: false, message: err.response?.data?.msg || err.message || 'Failed to create ArifPay payment' };
  }
}

/**
 * Helper to retrieve telegram_id from sessionId in webhook
 * @param {string} sessionId
 * @returns {string|null}
 */
function getTelegramIdFromSession(sessionId) {
  return sessionUserMap.get(sessionId) || null;
}

module.exports = { createArifPayPayment, formatPhone, getTelegramIdFromSession };

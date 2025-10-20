const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/user');
const Transaction = require('../models/transaction');

// Live/test mode configuration (do not hard-code; read from env)
const CHAPA_MODE = process.env.CHAPA_MODE || 'live';
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY;
if (!CHAPA_SECRET_KEY) throw new Error('Missing CHAPA_SECRET_KEY in .env for live mode');
const CHAPA_AUTH_KEY = CHAPA_SECRET_KEY;
const CHAPA_API_BASE = process.env.CHAPA_API_BASE || 'https://api.chapa.co';
const PORT = process.env.PORT || 3000;
const CHAPA_DEBUG = process.env.CHAPA_DEBUG === '1' || process.env.CHAPA_DEBUG === 'true';

function baseUrl() {
  return process.env.NGROK_URL || `http://localhost:${PORT}`;
}

function signOk(secret, rawBody, signature) {
  if (!secret || !rawBody || !signature) return false;
  try {
    // Normalize potential prefixes like 'sha256=' and trim quotes
    const normalizeSig = (s) => String(s).trim().replace(/^sha256=/i, '').replace(/^"|"$/g, '');
    const provided = normalizeSig(signature);

    // Variant A (webhooks/x-chapa-signature style): HMAC(secret, rawBody)
    const hmacPayloadHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const hmacPayloadB64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    // Variant B (approval/Chapa-Signature style per docs): HMAC(secret, secret)
    const hmacSecretHex = crypto.createHmac('sha256', secret).update(String(secret)).digest('hex');
    const hmacSecretB64 = crypto.createHmac('sha256', secret).update(String(secret)).digest('base64');

    // Build buffers for timing-safe compare against either encoding of both variants
    const variants = [
      String(hmacPayloadHex).trim(),
      String(hmacPayloadB64).trim(),
      String(hmacSecretHex).trim(),
      String(hmacSecretB64).trim(),
    ];

    const right = Buffer.from(provided.toLowerCase(), 'utf8');
    for (const v of variants) {
      const left = Buffer.from(v.toLowerCase(), 'utf8');
      if (left.length === right.length && crypto.timingSafeEqual(left, right)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function findUserByTelegram(telegramId) {
  if (!telegramId) return null;
  return User.findOne({ telegram_id: String(telegramId) });
}

async function ensurePendingTx({ user, amount }) {
  const tx_ref = `1v1-${user.telegram_id}-${Date.now()}`;
  const rec = await Transaction.findOneAndUpdate(
    { tx_ref },
    { $setOnInsert: { userId: user._id, amount: Number(amount), status: 'pending', direction: 'deposit', provider: 'chapa' } },
    { upsert: true, new: true }
  );
  return { tx_ref: rec.tx_ref };
}

async function initDeposit({ chatId, amount, phone }) {
  const user = await findUserByTelegram(chatId);
  if (!user) throw new Error('User not found');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 5) throw new Error('Invalid amount');
  // Friendly key checks
  if (/TEST/i.test(CHAPA_AUTH_KEY || '')) {
    throw new Error('Chapa live mode: a TEST secret key is set. Replace with your LIVE secret (starts with CHASECK- or CHASECK-LIVE-)');
  }
  const { tx_ref } = await ensurePendingTx({ user, amount: amt });

  const emailDomain = process.env.CHAPA_EMAIL_DOMAIN || 'example.com';
  const staticEmail = process.env.CHAPA_STATIC_EMAIL || `payments@${emailDomain}`;
  const payload = {
    amount: amt.toFixed(2),
    currency: 'ETB',
    email: staticEmail,
    first_name: user.name || 'Guest',
    last_name: '',
    tx_ref,
  phone_number: phone || undefined,
    return_url: `${baseUrl()}/api/deposit/return?tx_ref=${encodeURIComponent(tx_ref)}&chatId=${user.telegram_id}`,
    callback_url: `${baseUrl()}/api/chapa-callback?chatId=${user.telegram_id}`,
  };

  try {
    if (CHAPA_DEBUG) {
      const obf = (k) => (k ? `${String(k).slice(0, 8)}...${String(k).slice(-4)}` : 'unset');
      console.log('[Chapa Debug] initDeposit', { mode: CHAPA_MODE, apiBase: CHAPA_API_BASE, authKey: obf(CHAPA_AUTH_KEY) });
    }
    const { data } = await axios.post(
      `${CHAPA_API_BASE}/v1/transaction/initialize`,
      payload,
      { headers: { Authorization: `Bearer ${CHAPA_AUTH_KEY}` } }
    );
    if (data?.status !== 'success') throw new Error('Chapa init failed');
    return { checkout_url: data.data.checkout_url, tx_ref };
  } catch (e) {
    const body = e.response?.data;
    let msg = e.message;
    if (body) {
      if (typeof body === 'string') msg = body;
      else if (typeof body.message === 'string') msg = body.message;
      else msg = JSON.stringify(body);
    }
    console.error('[Chapa Initialize] Error body:', body || e);
    throw new Error(`Chapa init failed: ${msg}`);
  }
}

async function verifyTx(tx_ref) {
  if (CHAPA_DEBUG) {
    const obf = (k) => (k ? `${String(k).slice(0, 8)}...${String(k).slice(-4)}` : 'unset');
    console.log('[Chapa Debug] verifyTx', { mode: CHAPA_MODE, apiBase: CHAPA_API_BASE, authKey: obf(CHAPA_AUTH_KEY), tx_ref });
  }
  const res = await axios.get(
    `${CHAPA_API_BASE}/v1/transaction/verify/${encodeURIComponent(tx_ref)}`,
    { headers: { Authorization: `Bearer ${CHAPA_AUTH_KEY}` } }
  );
  const ok = res?.data?.status === 'success' && res?.data?.data?.status === 'success';
  const amount = Number(res?.data?.data?.amount || 0);
  return { ok, amount, raw: res?.data };
}

async function creditIfNeeded({ tx_ref, amount }) {
  const tx = await Transaction.findOne({ tx_ref });
  if (!tx) throw new Error('Transaction not found');
  if (tx.status === 'success') return { already: true, amount: tx.amount };

  const user = await User.findById(tx.userId);
  if (!user) throw new Error('User not found on tx');

  tx.status = 'success';
  tx.amount = Number(amount);
  await tx.save();

  user.oneVsOne_balance = (user.oneVsOne_balance || 0) + tx.amount;
  await user.save();

  return { already: false, amount: tx.amount, user };
}

module.exports = {
  initDeposit,
  verifyTx,
  creditIfNeeded,
  signOk,
};

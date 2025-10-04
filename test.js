// mini-chapa-bot.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY;
const CHAPA_APPROVAL_SECRET = process.env.CHAPA_APPROVAL_SECRET;
const NGROK_URL = process.env.NGROK_URL || ''; // used as callback_url
const PORT = process.env.PORT || 3000;

if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
if (!CHAPA_SECRET_KEY) throw new Error('CHAPA_SECRET_KEY not set');
if (!CHAPA_APPROVAL_SECRET) throw new Error('CHAPA_APPROVAL_SECRET not set');

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('Telegram bot started (polling)');

// Simple in-memory state for demo: chatId -> { step, name, phone, amount }
const userState = new Map();

// basic phone normalization for Ethiopia (very permissive)
function normalizePhone(input) {
  let p = (input || '').toString().trim();
  p = p.replace(/\s+/g, '');
  p = p.replace(/[^0-9+]/g, '');
  // ensure 10-digit starting with 0 (092...) or accept +2519...
  if (/^0\d{9}$/.test(p)) return p; // 0927084146
  if (/^\+2519\d{8}$/.test(p)) return p.slice(1); // +2519... -> 2519...
  if (/^9\d{8}$/.test(p)) return '0' + p; // 912345678 -> 0912345678
  if (/^2519\d{8}$/.test(p)) return '0' + p.slice(3); // 2519... -> 09...
  throw new Error('Invalid phone format');
}

// helper to verify chapa transfer
async function verifyChapaTransfer(txRef, timeoutMs = 60000, intervalMs = 5000) {
  const start = Date.now();
  const url = `https://api.chapa.co/v1/transfers/verify/${txRef}`;

  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${CHAPA_SECRET_KEY}` },
        timeout: 20000
      });
      console.log('[verifyChapaTransfer] response:', JSON.stringify(resp.data, null, 2));

      if (resp.data.status === 'success') {
        // data may be object or string
        const data = typeof resp.data.data === 'string' ? { chapa_transfer_id: resp.data.data, status: 'queued' } : resp.data.data;
        return data;
      } else {
        // status not success (API-level), include message
        console.warn('[verifyChapaTransfer] API-level status not success:', resp.data);
        // still sleep and retry
      }
    } catch (err) {
      console.warn('[verifyChapaTransfer] verify request error:', err.message);
      // continue retrying until timeout
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  // timed out
  return null;
}

// create transfer (payout)
async function createChapaTransfer({ amount, reference, account_name, account_number }) {
  const payload = {
    amount: amount.toString(),
    reference,
    bank_code: 855, // telebirr code (example)
    account_name,
    account_number,
    callback_url: NGROK_URL ? `${NGROK_URL.replace(/\/$/, '')}/api/chapa-approval` : ''
  };

  console.log('[createChapaTransfer] payload:', payload);

  const resp = await axios.post('https://api.chapa.co/v1/transfers', payload, {
    headers: {
      Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  console.log('[createChapaTransfer] response:', JSON.stringify(resp.data, null, 2));
  return resp.data;
}

// Telegram flow
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  userState.set(chatId, { step: 'ask_name' });
  await bot.sendMessage(chatId, 'Welcome — to test payout please send your *full name*:', { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const txt = (msg.text || '').trim();

  // ignore commands other than /start
  if (txt.startsWith('/')) return;

  const state = userState.get(chatId) || { step: 'ask_name' };

  try {
    if (state.step === 'ask_name') {
      state.name = txt;
      state.step = 'ask_phone';
      userState.set(chatId, state);
      return bot.sendMessage(chatId, 'Please enter your phone number (e.g. 0927xxxxxx or +2519xxxxxxx):');
    }

    if (state.step === 'ask_phone') {
      try {
        const normalized = normalizePhone(txt);
        state.phone = normalized.startsWith('+') ? normalized : (normalized.startsWith('0') ? normalized : normalized);
        state.step = 'ask_amount';
        userState.set(chatId, state);
        return bot.sendMessage(chatId, 'Enter withdraw amount in ETB (minimum 5):');
      } catch (err) {
        return bot.sendMessage(chatId, 'Invalid phone format. Please enter again (e.g. 0927xxxxxx or +2519xxxxxxx):');
      }
    }

    if (state.step === 'ask_amount') {
      const amount = Number(txt);
      if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, 'Enter a valid numeric amount.');
      if (amount < 5) return bot.sendMessage(chatId, 'Minimum amount is 5 ETB. Enter a higher amount.');

      state.amount = amount;
      userState.set(chatId, state);

      // all collected — initiate transfer
      const txRef = `withdraw${chatId}${Date.now()}`;
      await bot.sendMessage(chatId, `Processing withdrawal of ${amount} ETB to ${state.phone} (tx_ref: ${txRef})...`);

      try {
        // create transfer
        const chapaResp = await createChapaTransfer({
          amount,
          reference: txRef,
          account_name: state.name,
          account_number: state.phone
        });

        // immediate message with chapa response
        await bot.sendMessage(chatId, `Chapa response: ${chapaResp.message || JSON.stringify(chapaResp)}`);

        // try to verify for up to 1 minute (adjustable)
        const verifyTimeout = 60 * 1000; // 1 minute
        await bot.sendMessage(chatId, 'Verifying transfer status (will try for up to 60s)...');
        const transferData = await verifyChapaTransfer(txRef, verifyTimeout, 5000);

        if (!transferData) {
          await bot.sendMessage(chatId, `Verification timed out. Transfer may still be processing. tx_ref: ${txRef}`);
        } else if (transferData.status === 'success') {
          await bot.sendMessage(chatId, `✅ Withdrawal successful. tx_ref: ${txRef}\nChapa transfer id: ${transferData.chapa_transfer_id || transferData.chapa_transfer_id}`);
        } else {
          const reason = transferData.reason || transferData.message || 'No reason provided';
          await bot.sendMessage(chatId, `❌ Withdrawal failed (status: ${transferData.status}). Reason: ${reason}\nChapa transfer id: ${transferData.chapa_transfer_id || transferData.chapa_transfer_id}`);
        }
      } catch (err) {
        console.error('[Bot] create/verify error:', err.response?.data || err.message || err);
        await bot.sendMessage(chatId, `Error initiating withdrawal: ${err.response?.data?.message || err.message || 'unknown error'}`);
      }

      // reset state so user can test again
      userState.delete(chatId);
      return;
    }

  } catch (err) {
    console.error('[Bot] message handling error', err);
    userState.delete(chatId);
    return bot.sendMessage(chatId, 'An error occurred. Please /start to try again.');
  }
});

// -----------------
// Express server for webhook & health
// -----------------
const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Mini Chapa bot server running'));

app.post('/api/chapa-approval', async (req, res) => {
  try {
    console.log('[Webhook] payload received:', JSON.stringify(req.body, null, 2));
    const chapaSignature = req.headers['chapa-signature'] || req.headers['Chapa-Signature'];
    const bodyString = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', CHAPA_APPROVAL_SECRET).update(bodyString).digest('hex');

    if (chapaSignature !== expected) {
      console.error('[Webhook] signature mismatch', { received: chapaSignature, expected });
      return res.status(400).send('Invalid signature');
    }

    // body contains e.g. { reference, status, ... } — you can forward to user or log
    const { reference, status, reason } = req.body;
    console.log(`[Webhook] Transfer ${reference} status: ${status} reason: ${reason || 'n/a'}`);

    // Optionally, notify the user if tx_ref contains chatId we used in this demo:
    if (reference && reference.startsWith('withdraw')) {
      // Example reference format: withdraw<chatId><timestamp>
      const chatIdStr = reference.replace('withdraw', '').replace(/[0-9]{13,}/g, ''); // best-effort parse (demo)
      // Attempt to parse chatId numeric prefix; in our txRef we used chatId then Date.now()
      const match = reference.match(/^withdraw(\d+)\d{13,}$/);
      if (match) {
        const chatId = Number(match[1]);
        const msg = `Webhook: transfer ${reference} status ${status}${reason ? `, reason: ${reason}` : ''}`;
        try { await bot.sendMessage(chatId, msg); } catch (e) { console.warn('[Webhook] could not notify user', e.message); }
      }
    }

    return res.status(200).send('Approval processed');
  } catch (err) {
    console.error('[Webhook] error', err);
    return res.status(500).send('Server error');
  }
});

app.listen(PORT, () => {
  console.log(`Express listening on port ${PORT}`);
});

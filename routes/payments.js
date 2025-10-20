const express = require('express');
const router = express.Router();
const { initDeposit, verifyTx, creditIfNeeded, signOk } = require('../services/chapa');
const { finalize } = require('../services/withdraw');
const { emitToUser } = require('../utils/socket');
// Live-only: prefer dashboard webhook secret; fallback to API secret
const WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET || process.env.CHAPA_SECRET_KEY;
const bot = require('../bot');

// Init deposit
router.post('/deposit/init', express.json(), async (req, res) => {
  try {
    const { chatId, amount, phone } = req.body;
    const { checkout_url, tx_ref } = await initDeposit({ chatId, amount, phone });
    res.json({ checkout_url, tx_ref });
  } catch (e) {
    console.error('[payments/init] err:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// Return URL (under /api) - tolerate various param names and missing chatId
router.get('/deposit/return', async (req, res) => {
  const tx_ref = req.query.tx_ref || req.query.trx_ref || req.query.reference || req.query.ref || req.query.ref_id;
  const chatId = req.query.chatId || req.query.chat_id;
  if (!tx_ref) return res.status(400).send('Missing tx_ref');
  try {
    const { ok, amount } = await verifyTx(tx_ref);
    if (!ok) return res.status(400).send('Payment not successful');
    const result = await creditIfNeeded({ tx_ref, amount });
    const notifyId = chatId || result.user?.telegram_id;
    if (notifyId) {
      try { bot.sendMessage(notifyId, `✅ Deposit successful: ${amount} ETB${result.already ? ' (already credited)' : ''}. Balance: ${result.user?.oneVsOne_balance ?? '—'} ETB`); } catch {}
    }
    res.send('Payment successful. You can close this window.');
  } catch (e) {
    console.error('[payments/return] err:', e.message);
    res.status(500).send('Verification failed');
  }
});

// Webhook: use raw body only for this route
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Accept multiple signature headers per Chapa docs
  const signature = req.headers['chapa-signature'] || req.headers['x-chapa-signature'] || req.headers['x-signature'] || req.headers['signature'];
  // Robust raw body extraction: prefer req.rawBody (captured by global parser), else derive from current body
  const raw = req.rawBody
    ? req.rawBody
    : (Buffer.isBuffer(req.body)
      ? req.body
      : (typeof req.body === 'string'
        ? Buffer.from(req.body)
        : Buffer.from(JSON.stringify(req.body || {}))));
  const CHAPA_MODE = process.env.CHAPA_MODE || 'test';
  const debug = process.env.CHAPA_DEBUG === '1' || process.env.CHAPA_DEBUG === 'true';

  // Try multiple secrets to tolerate dashboard misconfig: primary webhook secret, fallback to API secret & approval secret
  const candidates = [];
  const add = (source, val) => { if (val && !candidates.find(c => c.value === val)) candidates.push({ source, value: val }); };
  add('webhook_secret', process.env.CHAPA_WEBHOOK_SECRET);
  add('api_secret', process.env.CHAPA_SECRET_KEY);
  add('transfer_approval_secret', process.env.CHAPA_TRANSFER_APPROVAL_SECRET);

  let valid = false;
  let matched = null;
  const sigPreview = signature ? `${String(signature).slice(0, 6)}...${String(signature).slice(-6)}` : 'unset';
  for (const c of candidates) {
    if (signOk(c.value, raw, signature)) { valid = true; matched = c.source; break; }
    if (debug && signature) {
      try {
        const crypto = require('crypto');
        const compPayload = crypto.createHmac('sha256', c.value).update(raw).digest('hex');
        const compSecret = crypto.createHmac('sha256', c.value).update(String(c.value)).digest('hex');
        const compPayloadPreview = `${compPayload.slice(0, 6)}...${compPayload.slice(-6)}`;
        const compSecretPreview = `${compSecret.slice(0, 6)}...${compSecret.slice(-6)}`;
        console.log('[webhook] debug compare', { source: c.source, signature: sigPreview, payloadHex: compPayloadPreview, secretHex: compSecretPreview });
      } catch {}
    }
  }
  const obf = (s) => (s ? `${String(s).slice(0, 4)}***${String(s).slice(-4)}` : 'unset');
  const preview = candidates.slice(0,3).map(c => `${c.source}:${obf(c.value)}`);
  if (debug) console.log('[webhook] hit', { valid, mode: CHAPA_MODE, hasSignature: !!signature, contentType: req.headers['content-type'], bodyLen: Buffer.isBuffer(raw) ? raw.length : 0, matched, sigPreview, candidatesPreview: preview, headerKeys: Object.keys(req.headers || {}) });
  if (!valid) return res.status(401).send('Invalid signature');
  // Parse payload from preserved raw buffer to avoid mismatches with global JSON parser
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    // Fallback: if body was already parsed upstream, use it directly
    if (req && req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      payload = req.body;
    } else {
      return res.status(400).send('Bad payload');
    }
  }
  const event = payload?.event || payload?.type || payload?.data?.event || payload?.data?.type;
  const isPayout = /payout/i.test(String(event || payload?.type || '')) || String(payload?.type || '').toLowerCase() === 'payout';

  if (isPayout) {
    // Handle transfer (withdrawal) webhook
    const reference = payload?.reference || payload?.data?.reference || payload?.tx_ref || payload?.data?.tx_ref;
    const status = payload?.status || payload?.data?.status;
    const ok = /success/i.test(String(status || '')) || /payout\.success/i.test(String(payload?.event || ''));
    if (!reference) return res.sendStatus(200);
    try {
      const wd = await finalize({ tx_ref: reference, ok, failureReason: payload?.message || payload?.reason || payload?.data?.reason });
      try {
        const chatId = wd?.userId?.telegram_id;
        if (chatId) {
          const msg = ok
            ? `✅ Withdraw successful: ${wd.amount} ETB`
            : `❌ Withdraw failed: ${wd.amount} ETB. Reason: ${wd.failureReason || 'unknown'}`;
          await bot.sendMessage(chatId, msg);
          // Live balance update for client UI
          const user = wd.userId;
          if (user) {
            emitToUser(chatId, 'balance-updated', { balance: user.oneVsOne_balance, hold: user.oneVsOne_hold, reason: ok ? 'withdraw-success' : 'withdraw-failed', tx_ref: reference });
          }
        }
      } catch {}
      return res.sendStatus(200);
    } catch (e) {
      console.error('[webhook/payout] err:', e.message);
      return res.sendStatus(200);
    }
  }

  // Default: handle deposit webhook
  const tx_ref = payload?.tx_ref || payload?.data?.tx_ref;
  if (!tx_ref) return res.sendStatus(200);
  try {
    const { ok, amount } = await verifyTx(tx_ref);
    if (ok) {
      const result = await creditIfNeeded({ tx_ref, amount });
      if (result?.user) {
        try { bot.sendMessage(result.user.telegram_id, `✅ Deposit successful: ${amount} ETB${result.already ? ' (already credited)' : ''}. Balance: ${result.user.oneVsOne_balance} ETB`); } catch {}
        try { emitToUser(result.user.telegram_id, 'balance-updated', { balance: result.user.oneVsOne_balance, reason: 'deposit', tx_ref }); } catch {}
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[payments/webhook] err:', e.message);
    res.sendStatus(200);
  }
});

// Legacy callback fallback
router.post('/chapa-callback', express.json(), async (req, res) => {
  const chatId = req.query.chatId;
  const tx_ref = req.body?.tx_ref || req.body?.trx_ref || req.body?.ref_id;
  if (!chatId || !tx_ref) return res.sendStatus(400);
  try {
    const { ok, amount } = await verifyTx(tx_ref);
    if (ok) {
      const result = await creditIfNeeded({ tx_ref, amount });
      try { bot.sendMessage(chatId, `✅ Deposit successful: ${amount} ETB${result.already ? ' (already credited)' : ''}.`); } catch {}
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[payments/callback] err:', e.message);
    res.sendStatus(500);
  }
});

module.exports = router;

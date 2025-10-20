const express = require('express');
const router = express.Router();
const { reserveAndCreate, requestPayout, finalize } = require('../services/withdraw');
const { signOk } = require('../services/chapa');
const bot = require('../bot');
const crypto = require('crypto');

// POST /api/withdraw - reserve and start payout
router.post('/withdraw', express.json(), async (req, res) => {
  let wd;
  try {
    const { chatId, amount, phone, wallet, channel } = req.body;
    const { withdraw } = await reserveAndCreate({ chatId, amount, phone, wallet, channel });
    wd = withdraw;
    const data = await requestPayout({ withdraw, chatId });
    return res.json({ tx_ref: withdraw.tx_ref, status: withdraw.status, provider: data });
  } catch (e) {
    console.error('[withdraw/init] err:', e.response?.data || e.message);
    // If provider init failed after we reserved funds, refund the hold and mark failed
    if (wd?.tx_ref) {
      try { await finalize({ tx_ref: wd.tx_ref, ok: false, failureReason: e.response?.data?.message || e.message }); } catch {}
    }
    return res.status(400).json({ error: e.response?.data || e.message });
  }
});

// POST /api/withdraw/callback - provider callback to finalize
router.post('/withdraw/callback', express.json(), async (req, res) => {
  try {
    const { chatId, tx_ref } = req.query;
    const ok = req.body?.status === 'success' || req.body?.data?.status === 'success';
    console.log('[withdraw/callback] hit', { tx_ref, ok, body: req.body });
    const wd = await finalize({ tx_ref, ok, failureReason: req.body?.message });
    try {
      const msg = ok ? `✅ Withdraw successful: ${wd.amount} ETB` : `❌ Withdraw failed: ${wd.amount} ETB. Reason: ${wd.failureReason || 'unknown'}`;
      if (chatId) await bot.sendMessage(chatId, msg);
    } catch {}
    res.sendStatus(200);
  } catch (e) {
    console.error('[withdraw/callback] err:', e.message);
    res.sendStatus(200);
  }
});

module.exports = router;

// Auto-approve transfers via Chapa URL verification (if enabled on dashboard)
// In Chapa dashboard: set Transfer Approval URL to `${NGROK_URL}/api/transfer/approve`
// and set the secret to CHAPA_TRANSFER_APPROVAL_SECRET
router.post('/transfer/approve', async (req, res) => {
  try {
    const CHAPA_MODE = process.env.CHAPA_MODE || 'test';
    // Build candidate secrets list to tolerate dashboard mismatches
    const candidates = [];
    const add = (source, val) => { if (val && !candidates.find(c => c.value === val)) candidates.push({ source, value: val }); };
    add('transfer_approval_secret', process.env.CHAPA_TRANSFER_APPROVAL_SECRET);
    add('webhook_secret', process.env.CHAPA_WEBHOOK_SECRET);
    add('api_secret', process.env.CHAPA_SECRET_KEY);
    const signature = req.headers['chapa-signature'] || req.headers['x-chapa-signature'] || req.headers['x-signature'] || req.headers['signature'];
    const contentType = req.headers['content-type'];
    const raw = req.rawBody
      ? req.rawBody
      : (Buffer.isBuffer(req.body)
        ? req.body
        : (typeof req.body === 'string'
          ? Buffer.from(req.body)
          : Buffer.from(JSON.stringify(req.body || {}))));
    let valid = false;
    let matched = null;
    const debug = (process.env.CHAPA_DEBUG === '1' || process.env.CHAPA_DEBUG === 'true');
    const sigPreview = signature ? `${String(signature).slice(0, 6)}...${String(signature).slice(-6)}` : 'unset';
    for (const c of candidates) {
      if (signOk(c.value, raw, signature)) { valid = true; matched = c.source; break; }
      if (debug && signature) {
        try {
          const compPayload = crypto.createHmac('sha256', c.value).update(raw).digest('hex');
          const compSecret = crypto.createHmac('sha256', c.value).update(String(c.value)).digest('hex');
          const compPayloadPreview = `${compPayload.slice(0, 6)}...${compPayload.slice(-6)}`;
          const compSecretPreview = `${compSecret.slice(0, 6)}...${compSecret.slice(-6)}`;
          console.log('[transfer/approve] debug compare', { source: c.source, signature: sigPreview, payloadHex: compPayloadPreview, secretHex: compSecretPreview });
        } catch {}
      }
    }
    const obf = (s) => (s ? `${String(s).slice(0, 4)}***${String(s).slice(-4)}` : 'unset');
    const preview = candidates.slice(0,3).map(c => `${c.source}:${obf(c.value)}`); // limit log size
    console.log('[transfer/approve] hit', { valid, mode: CHAPA_MODE, hasSignature: !!signature, contentType, bodyLen: raw.length, matched, sigPreview, candidatesPreview: preview, headerKeys: Object.keys(req.headers || {}) });
    if (!valid) return res.status(401).send('Invalid signature');
    // Optionally parse and log the payload
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch {}
    // Approve by returning 200; some integrations expect a simple JSON status
    return res.status(200).json({ status: 'success', message: 'approved' });
  } catch (e) {
    console.error('[transfer/approve] err:', e.message);
    return res.status(500).send('error');
  }
});

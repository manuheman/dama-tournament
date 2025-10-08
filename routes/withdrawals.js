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
// POST /api/transfer/approve
router.post('/transfer/approve', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const approvalSecret = process.env.CHAPA_TRANSFER_APPROVAL_SECRET;
    if (!approvalSecret) {
      console.error('[transfer/approve] Missing CHAPA_TRANSFER_APPROVAL_SECRET');
      return res.status(500).send('Server misconfigured');
    }

    const signature =
      req.headers['chapa-signature'] ||
      req.headers['x-chapa-signature'] ||
      req.headers['signature'];

    if (!signature) {
      console.warn('[transfer/approve] Missing signature header');
      return res.status(401).send('Missing signature');
    }

    // Compute expected signature
    const rawBody = req.body; // express.raw() ensures Buffer
    const expected = crypto
      .createHmac('sha256', approvalSecret)
      .update(rawBody)
      .digest('hex');

    const sigPreview = `${String(signature).slice(0, 6)}...${String(signature).slice(-6)}`;
    const expPreview = `${expected.slice(0, 6)}...${expected.slice(-6)}`;

    if (expected !== signature) {
      console.warn('[transfer/approve] Invalid signature', {
        sigPreview,
        expPreview,
        bodyLen: rawBody.length,
      });
      return res.status(401).send('Invalid signature');
    }

    // Parse JSON payload if valid
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {}

    console.log('[transfer/approve] Approved', {
      sigPreview,
      bodyLen: rawBody.length,
      payload,
    });

    return res.status(200).json({ status: 'success', message: 'approved' });
  } catch (err) {
    console.error('[transfer/approve] Error', err.message);
    return res.status(500).send('error');
  }
});

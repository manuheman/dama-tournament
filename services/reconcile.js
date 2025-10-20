// services/reconcile.js
// Periodically reconcile stale pending withdrawals by verifying with Chapa
const axios = require('axios');
const Withdraw = require('../models/withdraw');
const { finalize } = require('./withdraw');

const CHAPA_MODE = process.env.CHAPA_MODE || 'test';
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY; // live secret
const CHAPA_API_BASE = process.env.CHAPA_API_BASE || 'https://api.chapa.co';
const CHAPA_DEBUG = process.env.CHAPA_DEBUG === '1' || process.env.CHAPA_DEBUG === 'true';

async function verifyTransfer(reference) {
  try {
    const url = `${CHAPA_API_BASE}/v1/transfers/verify/${encodeURIComponent(reference)}`;
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${CHAPA_SECRET_KEY}` } });
    const status = data?.data?.status || data?.status;
    return { ok: /success/i.test(String(status || '')), raw: data };
  } catch (e) {
    if (CHAPA_DEBUG) console.error('[reconcile] verifyTransfer error:', e.response?.data || e.message);
    return { ok: false, error: e };
  }
}

async function reconcilePending({ olderThanMinutes = 10, limit = 20 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const pendings = await Withdraw.find({ status: 'pending', createdAt: { $lt: cutoff }, provider: 'chapa' }).limit(limit);
  if (!pendings.length) return { checked: 0, finalized: 0 };
  let finalized = 0;
  for (const wd of pendings) {
    const ref = wd.tx_ref;
    const { ok } = await verifyTransfer(ref);
    try {
      await finalize({ tx_ref: ref, ok, failureReason: ok ? undefined : 'reconciled-failure' });
      finalized++;
    } catch (e) {
      if (CHAPA_DEBUG) console.error('[reconcile] finalize error:', e.message);
    }
  }
  return { checked: pendings.length, finalized };
}

function startScheduler() {
  const intervalMin = Number(process.env.RECONCILE_MINUTES || 15);
  if (intervalMin <= 0) return;
  setInterval(async () => {
    try {
      const res = await reconcilePending({ olderThanMinutes: intervalMin, limit: 50 });
      if (CHAPA_DEBUG) console.log('[reconcile] tick', res);
    } catch (e) {
      if (CHAPA_DEBUG) console.error('[reconcile] tick error:', e.message);
    }
  }, intervalMin * 60 * 1000);
  if (CHAPA_DEBUG) console.log(`[reconcile] scheduler started: every ${intervalMin} minutes`);
}

module.exports = { startScheduler, reconcilePending };

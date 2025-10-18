// routes/deposit.js
const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { createArifPayPayment } = require('../services/arifpay');
const { getTelegramIdFromSession } = require('../services/arifpay');
const bot = require('../bot'); // import your Telegram bot instance

// -------------------------
// POST /api/deposit
// User initiates a deposit
router.post('/', async (req, res) => {
  const { chatId, amount, phone } = req.body;

  console.log('[Deposit] Received deposit request:', { chatId, amount, phone });

  if (!chatId || !amount || !phone) {
    console.log('[Deposit] Missing fields in request');
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    // ✅ Find user by Telegram ID (chatId)
    const user = await User.findOne({ telegram_id: chatId });
    if (!user) {
      console.log(`[Deposit] User not found for chatId: ${chatId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`[Deposit] Found user: ${user.name} (${user.phone_number})`);

    // ✅ Pass only the telegram_id to the ArifPay service
    const result = await createArifPayPayment(amount, user.telegram_id, phone);

    if (result.success) {
      console.log(`[Deposit] Payment request created for ${user.name} (${phone}), amount: ${amount}, sessionId: ${result.sessionId}`);
      return res.json({ success: true, message: result.message, sessionId: result.sessionId, paymentUrl: result.paymentUrl });
    } else {
      console.log(`[Deposit] Failed to create payment: ${result.message}`);
      return res.status(500).json({ success: false, message: result.message });
    }
  } catch (err) {
    console.error('[Deposit] Error creating payment:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// -------------------------
// POST /api/deposit/webhook
router.post('/webhook', async (req, res) => {
  try {
    console.log('[Webhook] 🔔 Incoming ArifPay payload:');
    console.dir(req.body, { depth: null, colors: true });

    const data = req.body.data || req.body || {};
    const sessionId = data.sessionId || data.uuid || data.transaction?.transactionId;

    if (!sessionId) {
      console.log('[Webhook] ❌ sessionId missing in payload');
      return res.status(400).json({ success: false, message: 'sessionId missing' });
    }

    // ✅ Retrieve telegram_id from session map
    const telegram_id = getTelegramIdFromSession(sessionId);
    if (!telegram_id) {
      console.log(`[Webhook] ❌ No telegram_id mapping found for sessionId: ${sessionId}`);
      return res.status(404).json({ success: false, message: 'User not found for this session' });
    }

    // ✅ Find user in DB
    const user = await User.findOne({ telegram_id: telegram_id.toString() });
    if (!user) {
      console.log(`[Webhook] ❌ User not found with telegram_id: ${telegram_id}`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Extract payment info safely
    const amount = parseFloat(data.amount || data.totalAmount || data.transaction?.amount || data.items?.[0]?.price || 0);
    const status = (data.status || data.transactionStatus || data.paymentStatus || data.payment_state || '').toUpperCase();

    if (status !== 'SUCCESS') {
      console.log(`[Webhook] ⚠️ Payment not successful for Telegram ID ${telegram_id}. Status: ${status}`);
      return res.json({ success: false, message: 'Payment not completed or pending' });
    }

    // Update user balance
    user.oneVsOne_balance = (user.oneVsOne_balance || 0) + amount;
    await user.save();

    console.log(`[Webhook] 💰 Credited ${amount} Birr to ${user.name}. New balance: ${user.oneVsOne_balance}`);

    // Notify user via Telegram
    if (bot && user.telegram_id) {
      await bot.sendMessage(
        user.telegram_id,
        `✅ Payment of ${amount} Birr confirmed!\nYour new balance: ${user.oneVsOne_balance} Birr.\nTransaction ID: ${sessionId}\ncheck your balance  /balance`
      );
      console.log(`[Webhook] 📩 Telegram message sent to ${user.name} (${user.telegram_id})`);
    }

    // Respond to ArifPay
    res.json({ success: true, message: 'Webhook processed successfully' });

  } catch (err) {
    console.error('[Webhook] ❌ Error processing webhook:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;

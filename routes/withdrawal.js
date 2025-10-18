const express = require("express");
const router = express.Router();
const { createWithdrawalSession, handleWebhook } = require("../services/withdrawal");
const User = require("../models/user");
const axios = require("axios"); // Only needed for direct B2C execution

// ================================
// POST /api/withdraw/session
// Create a withdrawal session
// ================================
router.post("/session", express.json(), async (req, res) => {
  try {
    const { chatId, amount, phone } = req.body;

    // Validate required fields
    if (!chatId || !amount || !phone) {
      return res.status(400).json({
        success: false,
        message: "chatId, amount, and phone are required"
      });
    }

    // Find user by Telegram ID
    const user = await User.findOne({ telegram_id: chatId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Create withdrawal session via service
    const result = await createWithdrawalSession(user, amount, phone);

    res.json(result);
  } catch (err) {
    console.error("[Withdraw Session Error]", err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ================================
// POST /api/withdraw/webhook/telebirr
// ArifPay Telebirr webhook handler
// ================================
router.post("/webhook/telebirr", express.json(), async (req, res) => {
  try {
    await handleWebhook(req, res);
  } catch (err) {
    console.error("[Webhook Route Error]", err);
    res.status(500).send("Server error");
  }
});

module.exports = router;

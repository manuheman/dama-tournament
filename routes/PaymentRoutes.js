const express = require("express");
const router = express.Router();
const bot = require("../bot"); // your Telegram bot instance
const User = require("../models/user");
const Tournament = require("../models/tournament");
const PendingTournament = require("../models/PendingTournament");

// ✅ Payment callback
router.post("/payment-callback", async (req, res) => {
  try {
    // Extract info from callback body
    const { phone, totalAmount, transactionStatus, transaction, paymentMethod } = req.body;

    // Extract chatId and type from query params
    const chatId = req.query.chatId;
    const type = req.query.type;

    console.log("📩 Payment callback received:", req.body);

    // Find user
    const user = await User.findOne({ telegram_id: chatId });
    if (!user) {
      console.log("❌ User not found for chatId:", chatId);
      return res.status(404).json({ error: "User not found" });
    }

    // Check if payment was successful
    const success = transactionStatus === "SUCCESS" || transaction?.transactionStatus === "SUCCESS";

    if (success) {
      // ✅ Save pending tournament
      await PendingTournament.create({
        user: user._id,
        type: type,
        balance: totalAmount,
        txRef: transaction.transactionId || transaction.uuid || transaction.nonce,
        status: "paid"
      });

      // ✅ Register user into tournament
      let tournament = await Tournament.findOne({ type, balance: totalAmount, status: "open" });
      if (!tournament) {
        tournament = await Tournament.create({ type, balance: totalAmount, players: [], status: "open" });
      }

      if (!tournament.players.includes(user._id)) {
        tournament.players.push(user._id);
        await tournament.save();
      }

      // ✅ Notify user
      bot.sendMessage(chatId, `✅ Your ${type} tournament registration with ${totalAmount} birr is confirmed!`);
      console.log(`✅ User ${chatId} registered in ${type} tournament for ${totalAmount} birr.`);
    } else {
      // ❌ Payment failed
      bot.sendMessage(chatId, `❌ Payment failed or cancelled for ${type} tournament. You are not registered.`);
      console.log(`❌ Payment failed for user ${chatId} in ${type} tournament.`);
    }

    // Respond to the payment provider
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Callback error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

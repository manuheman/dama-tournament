// services/withdrawal.js
const axios = require("axios");
const crypto = require("crypto");
const Withdrawal = require("../models/withdraw");
const User = require("../models/user");
require("dotenv").config();

// === Utility: Generate unique reference ===
function generateReference(prefix = "WD") {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}

// === Step 1: Create withdrawal session via ArifPay API ===
async function createWithdrawalSession(user, amount, phone) {
  if (!user || !amount || !phone) {
    throw new Error("User, amount, and phone are required to create a withdrawal session");
  }

  const reference = generateReference();
  const method = "Telebirr";

  // Save pending withdrawal in DB
  const withdrawal = await Withdrawal.create({
    user: user._id,
    chatId: user.telegram_id,
    amount,
    method,
    phone,
    reference,
    status: "pending",
  });

  const payload = {
    cancelUrl: `${process.env.NGROK_URL}/cancel`,
    phone,
    email: user.email || "no-reply@example.com",
    nonce: crypto.randomBytes(12).toString("hex"),
    errorUrl: `${process.env.NGROK_URL}/error`,
    notifyUrl: `${process.env.NGROK_URL}/api/withdraw/webhook/telebirr`,
    successUrl: `${process.env.NGROK_URL}/success`,
    paymentMethods: ["TELEBIRR_USSD"],
    items: [
      {
        name: "Withdrawal",
        quantity: 1,
        price: amount,
        description: "User withdrawal",
      },
    ],
    beneficiaries: [
      {
        accountNumber: process.env.WITHDRAW_ACCOUNT || "01320811436100",
        bank: "AWINETAA",
        amount,
      },
    ],
    lang: "EN",
    expireDate: process.env.SESSION_EXPIRE, // e.g., "2025-12-31T23:59:59"
  };

  try {
    // ✅ Call ArifPay API directly
    const { data } = await axios.post(
      "https://api.arifpay.net/checkout/create-session", // Use .net
      payload,
      {
        headers: {
          "x-arifpay-key": process.env.ARIFPAY_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (data.error) {
      await Withdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "failed",
        responseData: data,
      });
      return { success: false, message: data.msg || "Failed to create session" };
    }

    const sessionId = data.data.sessionId;

    await Withdrawal.findByIdAndUpdate(withdrawal._id, {
      status: "processing",
      providerTxnId: sessionId,
      responseData: data,
    });

    return { success: true, reference, sessionId, message: "Session created successfully" };
  } catch (err) {
    console.error("[ArifPay] Session error:", err.response?.data || err.message);
    await Withdrawal.findByIdAndUpdate(withdrawal._id, {
      status: "failed",
      responseData: { error: err.message },
    });
    return { success: false, message: "Error creating withdrawal session" };
  }
}

// === Step 2: Optional direct B2C execution ===
async function executeWithdrawal(sessionId, phone, amount) {
  if (!sessionId || !phone || !amount) {
    throw new Error("Session ID, phone, and amount are required for withdrawal execution");
  }

  const url = process.env.TELEBIRR_B2C_URL || "https://telebirr-b2c.arifpay.net/api/Telebirr/b2c/transfer";
  const payload = { Sessionid: sessionId, Phonenumber: phone, Amount: amount };
  const headers = { "x-arifpay-key": process.env.ARIFPAY_API_KEY, "Content-Type": "application/json" };

  try {
    const { data } = await axios.post(url, payload, { headers });

    if (data?.error) {
      return { success: false, message: data.msg || "Transfer failed", data };
    }

    return { success: true, data, message: "Withdrawal executed successfully" };
  } catch (err) {
    console.error("[Telebirr B2C] Execute error:", err.response?.data || err.message);
    return { success: false, message: "Error executing withdrawal" };
  }
}

// === Step 3: Webhook handler ===
async function handleWebhook(req, res) {
  try {
    const payload = req.body;
    console.log("[ArifPay Webhook] Received:", payload);

    const { uuid, status } = payload;

    const withdrawal =
      (await Withdrawal.findOne({ providerTxnId: uuid })) ||
      (await Withdrawal.findOne({ reference: uuid }));

    if (!withdrawal) return res.status(404).send("Withdrawal not found");

    withdrawal.webhookData = payload;

    if (status === "SUCCESS") {
      withdrawal.status = "success";
      const user = await User.findById(withdrawal.user);
      if (user) {
        user.oneVsOne_balance -= withdrawal.amount;
        await user.save();
      }
    } else if (status === "FAILED") {
      withdrawal.status = "failed";
    }

    await withdrawal.save();
    res.status(200).send("Webhook received");
  } catch (err) {
    console.error("[Webhook Error]", err);
    res.status(500).send("Server error");
  }
}

module.exports = {
  createWithdrawalSession,
  executeWithdrawal,
  handleWebhook,
};

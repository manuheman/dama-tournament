const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const User = require('./models/user');
const Tournament = require('./models/tournament');
const Fixture = require('./models/fixture');
const PendingTournament = require('./models/PendingTournament'); 
const Withdraw = require('./models/withdraw');



const CHAPA_API_KEY = process.env.CHAPA_API_KEY;

const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY;
// ✅ Load from environment
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NGROK_URL = process.env.NGROK_URL;
const ARIFPAY_API_KEY = process.env.ARIFPAY_API_KEY;

if (!TOKEN) throw new Error("❌ TELEGRAM_BOT_TOKEN not set.");
if (!NGROK_URL) throw new Error("❌ NGROK_URL not set.");
if (!ARIFPAY_API_KEY) throw new Error("❌ ARIFPAY_API_KEY not set.");

// ✅ Build webhook
const WEBHOOK_URL = `${NGROK_URL}/bot${TOKEN}`;
const bot = new TelegramBot(TOKEN);
bot.setWebHook(WEBHOOK_URL);
console.log('✅ Webhook set:', WEBHOOK_URL);

// ----- Waiting states -----
const waitingForName = new Set();
const waitingForContact = new Map();
const waitingForTournamentType = new Map();

const waitingForWithdrawAmount = new Map(); // chatId => {}
const waitingForWithdrawPhone = new Map();  // chatId => { amount }




const postRegistrationMenu = [
  [
    { text: '🎯 Tournament', callback_data: 'post_tournament' },
    { text: '🤝 1v1 Game', callback_data: 'post_1v1' }
  ],
  [
    { text: 'ℹ️ My Info', callback_data: 'my_info' },
    { text: '📞 Contact Us', callback_data: 'contact_us' }
  ],
  [
    { text: '🤝 Join Group', url: 'https://t.me/EthioDamaTournament' }
  ]
];



const withdrawalMethodButtons = [
  [{ text: 'Telebirr', callback_data: 'withdraw_telebirr' }],
  [{ text: 'CBE Birr', callback_data: 'withdraw_cbe' }],
  [{ text: 'M-Pesa', callback_data: 'withdraw_mpesa' }],
  [{ text: '⬅️ Back', callback_data: 'post_1v1' }]
];



// ----- User cache -----
const userCache = new Map(); // chatId => user
async function getCachedUser(chatId, telegramId) {
  if (userCache.has(chatId)) return userCache.get(chatId);
  const user = await User.findOne({ telegram_id: telegramId });
  if (user) userCache.set(chatId, user);
  return user;
}

// ----- Menus -----
const mainMenuButtons = (chatId) => [
  [
    { text: '📊 Dashboard', web_app: { url: `${NGROK_URL}/user-dashboard.html?userId=${chatId}` } },
    { text: '🏆 My Code', callback_data: 'my_code' }
  ],
  [
    { text: '📝 Register Tournament', callback_data: 'register_tournament' },
    
  ],
  [
    { text: '📅 Fixtures', callback_data: 'fixture' },
     { text: '🎮 How to Play', callback_data: 'how_to_play' }
    
  ],
  
  [
    { text: '📜 Rules & Privacy', callback_data: 'rules_privacy' },
    { text: '⬅️ Back', callback_data: 'back_to_post' }
  ]
];

async function sendMainMenu(chatId, text = '✨ Main Menu ✨\n\nChoose an option below:') {
  return bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: mainMenuButtons(chatId) } }).catch(console.error);
}

async function editMessage(chatId, messageId, text, buttons) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: buttons } });
  } catch {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
  }
}

// ----- User Fixtures -----
async function getUserFixtures(userId) {
  const fixtures = await Fixture.find({
    disabled: false,
    $or: [{ player1: userId }, { player2: userId }]
  })
  .populate('player1', 'name')
  .populate('player2', 'name')
  .populate('tournament', 'type balance')
  .sort({ round: 1, matchTime: 1 });

  return fixtures.map(f => {
    const p1 = f.player1 ? f.player1.name : 'TBD';
    const p2 = f.player2 ? f.player2.name : 'TBD';
    const resultText = f.result === 0 ? 'Pending' : f.result === 1 ? `${p1} Wins` : f.result === 2 ? `${p2} Wins` : 'Draw';
    const matchTime = f.matchTime ? new Date(f.matchTime).toLocaleString() : 'Not scheduled';

    return {
      tournamentType: f.tournament?.type || 'Unknown',
      balance: f.tournament?.balance || 0,
      round: f.round,
      matchText: `${p1} vs ${p2}`,
      resultText,
      matchTime
    };
  });
}

async function verifyChapaTransfer(tx_ref) {
  try {
    const res = await axios.get(`https://api.chapa.co/v1/transfers/verify/${tx_ref}`, {
      headers: { Authorization: `Bearer ${CHAPA_SECRET_KEY}` }
    });

    console.log('[Chapa Verify] Response:', res.data);
    return res.data.status === 'success';
  } catch (err) {
    console.error('[Chapa Verify] Error:', err.response?.data || err.message);
    return false;
  }
}


async function initiateChapaWithdrawal(withdrawal, userName) {
  try {
    // --- Prepare payload for Chapa ---
    const payload = {
      account_name: userName,
      account_number: withdrawal.phone, // Telebirr number
      amount: withdrawal.amount,
      currency: 'ETB',
      reference: withdrawal.tx_ref, // your custom reference
      bank_code: '855'
    };

    // --- Send transfer request ---
    const res = await axios.post(
      'https://api.chapa.co/v1/transfers',
      payload,
      {
        headers: {
          Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[Chapa Withdrawal] Response:', res.data);

    if (res.data.status === 'success' && res.data.data?.reference) {
      // --- Use the correct reference for verification ---
      const transferRef = res.data.data.reference;

      // --- Verify transfer immediately ---
      const verified = await verifyChapaTransfer(transferRef);

      if (verified) {
        withdrawal.status = 'success';
        await withdrawal.save();
        return {
          success: true,
          message: `✅ Withdrawal of ${withdrawal.amount} ETB SUCCESSFUL!`
        };
      } else {
        // --- Mark as pending if Chapa hasn't processed it yet ---
        withdrawal.status = 'pending';
        await withdrawal.save();
        return {
          success: false,
          message: `⏳ Transfer queued. Awaiting Chapa approval.`
        };
      }
    } else {
      // --- Failed transfer from Chapa API ---
      withdrawal.status = 'failed';
      await withdrawal.save();
      return {
        success: false,
        message: `❌ Withdrawal failed. Check Chapa dashboard.`
      };
    }

  } catch (err) {
    // --- Catch network or API errors ---
    withdrawal.status = 'failed';
    await withdrawal.save();
    console.error('[Chapa Withdrawal] Error:', err.response?.data || err.message);
    return { success: false, message: `❌ Error initiating withdrawal.` };
  }
}







// ----- Welcome Image -----
function sendWelcomeImage(chatId) {
  const imagePath = path.join(__dirname, "IMG.jpg");
  if (!fs.existsSync(imagePath)) return;
  const stream = fs.createReadStream(imagePath);
  bot.sendPhoto(chatId, stream, {
    caption: "🎉 Welcome to the Tournament Bot!",
    reply_markup: { inline_keyboard: mainMenuButtons(chatId) }
  }).catch(console.error);
}

// ----- Tournament Buttons -----
const tournamentTypeButtons = [
  [{ text: '🥉 Silver', callback_data: 'type_Silver' }, { text: '🥈 Gold', callback_data: 'type_Gold' }],
  [{ text: '🥇 Platinum', callback_data: 'type_Platinum' }],
  [{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]
];

// ----- /start -----
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const existingUser = await getCachedUser(chatId, telegramId);

    // ----- If user is already registered -----
    if (existingUser) {
      const imagePath = path.join(__dirname, "IMG.jpg");
      if (fs.existsSync(imagePath)) {
        const stream = fs.createReadStream(imagePath);
        await bot.sendPhoto(chatId, stream, {
          caption: `🎉 Welcome back, ${existingUser.name}!`,
          reply_markup: { inline_keyboard: postRegistrationMenu }
        });
      } else {
        await bot.sendMessage(chatId, `🎉 Welcome back, ${existingUser.name}!`, {
          reply_markup: { inline_keyboard: postRegistrationMenu }
        });
      }
      return;
    }

    // ----- If user is not registered: start registration -----
    bot.sendMessage(chatId, 'Welcome! Please send me your full name:');
    waitingForName.add(chatId);

  } catch (err) {
    console.error('Error on /start:', err);
    bot.sendMessage(chatId, '⚠️ Something went wrong, please try again.');
  }
});






// ----- Message Handler -----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  console.log(`[bot.on.message] New message from Telegram ID: ${telegramId}, Chat ID: ${chatId}, Text: "${msg.text}", Contact:`, msg.contact);

  // -------------------------
  // 1️⃣ Registration Name
  // -------------------------
  if (waitingForName.has(chatId)) {
    const name = msg.text?.trim();
    if (!name) {
      console.warn(`[Registration] Empty name received for chatId: ${chatId}`);
      return bot.sendMessage(chatId, '⚠️ Please send a valid name.');
    }

    waitingForName.delete(chatId);
    waitingForContact.set(chatId, { name });
    console.log(`[Registration] Name collected: ${name}, prompting for contact...`);

    return bot.sendMessage(chatId, '📞 Please share your phone number:', {
      reply_markup: {
        keyboard: [[{ text: 'Share Contact', request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }

  // -------------------------
  // 2️⃣ Registration Contact
  // -------------------------
  if (waitingForContact.has(chatId) && (msg.contact || msg.text)) {
    const { name } = waitingForContact.get(chatId);
    let phone = msg.contact?.phone_number || msg.text?.trim();

    try {
      phone = normalizePhone(phone);
      console.log(`[Registration] Normalized phone: ${phone}`);
    } catch {
      console.error(`[Registration] Invalid phone input: "${phone}"`);
      return bot.sendMessage(chatId, '⚠️ Invalid phone number.');
    }

    try {
      let user = await User.findOne({ telegram_id: telegramId });
      if (!user) {
        user = await User.create({
          telegram_id: telegramId,
          telegram_username: msg.from.username,
          name,
          phone_number: phone,
          balance: 0,
          oneVsOne_balance: 0
        });
        userCache.set(chatId, user);
        console.log(`[Registration] New user created: Telegram ID ${telegramId}`);
      } else {
        console.log(`[Registration] Existing user found: Telegram ID ${telegramId}`);
      }

      waitingForContact.delete(chatId);

      const postRegistrationMenu = [
        [
          { text: '🎯 Tournament', callback_data: 'post_tournament' },
          { text: '🤝 1v1 Game', callback_data: 'post_1v1' }
        ]
      ];

      const imagePath = path.join(__dirname, "IMG.jpg");
      if (fs.existsSync(imagePath)) {
        const stream = fs.createReadStream(imagePath);
        await bot.sendPhoto(chatId, stream, {
          caption: `🎉 Welcome, ${name}!`,
          reply_markup: { inline_keyboard: postRegistrationMenu }
        });
      } else {
        await bot.sendMessage(chatId, `🎉 Welcome, ${name}!`, {
          reply_markup: { inline_keyboard: postRegistrationMenu }
        });
      }

      console.log(`[Registration] Completed registration flow for chatId: ${chatId}`);
    } catch (err) {
      console.error('[Registration] Error saving user info:', err);
      return bot.sendMessage(chatId, '⚠️ Could not save your info. Please try again.');
    }
  }

  // -------------------------
  // 3️⃣ Chapa Deposit Amount
  // -------------------------
  if (waitingForChapaAmount.has(chatId)) {
    const amount = Number(msg.text);
    if (isNaN(amount) || amount <= 0) {
      console.warn(`[Chapa Deposit] Invalid amount input for chatId: ${chatId}: ${msg.text}`);
      return bot.sendMessage(chatId, '⚠️ Please enter a valid amount in Birr.');
    }

    waitingForChapaAmount.delete(chatId);
    waitingForChapaPhone.set(chatId, { amount });
    console.log(`[Chapa Deposit] Amount collected: ${amount} Birr for chatId: ${chatId}`);

    return bot.sendMessage(chatId, '📱 Please enter your phone number for Chapa payment:');
  }

  // -------------------------
  // 4️⃣ Chapa Deposit Phone
  // -------------------------
  if (waitingForChapaPhone.has(chatId)) {
    const { amount } = waitingForChapaPhone.get(chatId);
    let phone;

    try {
      phone = normalizePhone(msg.text.trim());
      console.log(`[Chapa Deposit] Normalized phone: ${phone} for chatId: ${chatId}`);
    } catch {
      console.error(`[Chapa Deposit] Invalid phone input: "${msg.text}"`);
      return bot.sendMessage(chatId, '⚠️ Invalid phone number.');
    }

    waitingForChapaPhone.delete(chatId);

    try {
      const user = await getCachedUser(chatId, telegramId);
      if (!user) return bot.sendMessage(chatId, '⚠️ User not found. Please /start.');

      console.log(`[Chapa Deposit] Sending deposit request to server API for chatId: ${chatId}, amount: ${amount}, phone: ${phone}`);

      const response = await axios.post(`${process.env.NGROK_URL}/api/deposit`, { chatId, amount, phone });
      console.log('[Chapa Deposit] Server response:', response.data);

      return bot.sendMessage(chatId, `💳 Complete your payment via Chapa by clicking below:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `Pay ${amount} Birr via Chapa`, url: response.data.checkoutUrl }],
            [{ text: '⬅️ Back', callback_data: 'post_1v1' }]
          ]
        }
      });
    } catch (err) {
      console.error('[Chapa Deposit] Error calling server API:', err.response?.data || err.message);
      return bot.sendMessage(chatId, '⚠️ Failed to create Chapa payment. Please try again.');
    }
  }

  //ask for amount withdrawal
  // ----- Withdrawal Amount Step -----
if (waitingForWithdrawAmount.has(chatId)) {
  const amount = parseFloat(msg.text);
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number.');
  }

  const user = await getCachedUser(chatId, telegramId);
  if (!user) return bot.sendMessage(chatId, '❌ User not found.');

  if (user.oneVsOne_balance < amount) {
    return bot.sendMessage(chatId, '❌ Insufficient balance.');
  }

  // Save amount and proceed to method selection
  waitingForWithdrawAmount.delete(chatId);
  waitingForWithdrawPhone.set(chatId, { amount });
  return bot.sendMessage(chatId, '📲 Choose your withdrawal method:', {
    reply_markup: { inline_keyboard: withdrawalMethodButtons }
  });
}
//telebirr number asking step
// ----- Telebirr Number Step -----

// ----- Telebirr Number Step -----
if (waitingForWithdrawPhone.has(chatId)) {
  const state = waitingForWithdrawPhone.get(chatId);

  if (state.step === 'waitingForTelebirrNumber') {
    let phone = msg.text.trim();
    if (!/^\d{10}$/.test(phone)) {
      return bot.sendMessage(chatId, '❌ Invalid Telebirr number. Please enter a 10-digit number.');
    }

    const user = await getCachedUser(chatId, telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ User not found.');

    const withdrawal = await Withdraw.create({
      userId: user._id,
      amount: state.amount,
      phone,
      tx_ref: `withdraw-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      status: 'pending'
    });

    user.oneVsOne_balance -= state.amount;
    await user.save();

    waitingForWithdrawPhone.delete(chatId);

    bot.sendMessage(chatId, `⏳ Initiating your withdrawal of ${state.amount} ETB via Telebirr...`);

    const result = await initiateChapaWithdrawal(withdrawal, user.name);
    bot.sendMessage(chatId, result.message);
  }
}




});





// ----- Direct ArifPay Payment -----
async function createArifPayPayment(amount, user, selectedType, method = "TELEBIRR") {
  const payload = {
    cancelUrl: "https://example.com/cancel",
    phone: user.phone_number,
    email: user.email || "guest@example.com",
    nonce: `${Date.now()}_${Math.random().toString(36).substring(2)}`,
    errorUrl: "https://example.com/error",
    notifyUrl: `${NGROK_URL}/api/payment-callback?chatId=${user.telegram_id}&type=${selectedType}`,
    successUrl: "https://example.com/success",
    paymentMethods: [method],
    expiredDate: new Date(Date.now() + 60*60*1000).toISOString(),
    items: [{ name: `${selectedType} Tournament Entry`, quantity: 1, price: amount, description: "" }],
    beneficiaries: [{ accountNumber: "01320811436100", bank: "AWINETAA", amount }],
    lang: "EN"
  };

 const urlMap = {
    "TELEBIRR": "https://gateway.arifpay.net/api/checkout/telebirr-ussd/transfer/direct",
    "CBE": "https://gateway.arifpay.net/api/checkout/v2/cbe/direct/transfer",
    "MPESA": "https://gateway.arifpay.net/api/checkout/mpesa/transfer/direct"
  };

  try {
    if (!urlMap[method]) throw new Error(`Unsupported payment method: ${method}`);

    const response = await axios.post(urlMap[method], payload, {
      headers: { "x-arifpay-key": ARIFPAY_API_KEY }
    });

    // ArifPay returns checkout URL in `checkoutUrl` or similar field
    return response.data.checkoutUrl;
  } catch (err) {
    console.error("🔥 ArifPay Direct API Error:", err.response?.data || err.message);
    throw err;
  }
}


// ----- Callback Queries -----
// ----- Temporary state maps -----
const waitingForChapaAmount = new Map(); // chatId => {}
const waitingForChapaPhone = new Map();  // chatId => { amount }

// ----- Callback Queries -----
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const data = callbackQuery.data;
  const telegramId = callbackQuery.from.id;

  bot.answerCallbackQuery(callbackQuery.id).catch(() => {});

  const requireRegistration = async (backData = 'back_to_main') => {
    await editMessage(chatId, messageId, '❌ Please register first using /start.', [
      [{ text: '⬅️ Back', callback_data: backData }]
    ]);
  };

  const user = await getCachedUser(chatId, telegramId);
  const removePreviousButtons = async () => {
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }); } catch {}
  };

  // ----- Helper buttons -----
  const oneVsOneMenu = [
    [
      { text: '🎮 Play', callback_data: '1v1_play' },
      { text: '💰 Balance', callback_data: '1v1_balance' }
    ],
    [
      { text: '💳 Deposit', callback_data: '1v1_deposit' },
      { text: '🏦 Withdraw', callback_data: '1v1_withdraw' }
    ],
    [
      { text: '📜 Transaction', callback_data: '1v1_transaction' },
      { text: '⬅️ Back', callback_data: 'back_to_post' }
    ]
  ];

  const chapaOrArifButtons = [
    [{ text: '💳 Chapa Pay', callback_data: 'deposit_chapa' }],
    [{ text: '💳 ArifPay', callback_data: 'deposit_arifpay' }],
    [{ text: '⬅️ Back', callback_data: 'post_1v1' }]
  ];

  try {
    switch (true) {

      // ----- User Info -----
      case data === 'my_info':
        if (!user) return requireRegistration();
        await removePreviousButtons();
        return editMessage(
          chatId,
          messageId,
          `Your Info:\n\nName: ${user.name}\nTelegram: @${user.telegram_username || 'N/A'}\nPhone: ${user.phone_number}`,
          [[{ text: '⬅️ Back', callback_data: 'back_to_post' }]]
        );

      // ----- Tournament Registration -----
      case data === 'register_tournament':
        await removePreviousButtons();
        return editMessage(chatId, messageId, '🎯 *Choose Tournament Type* 🎯', tournamentTypeButtons);

      case data.startsWith('type_'):
        if (!user) return requireRegistration();
        const selectedType = data.split('_')[1];
        waitingForTournamentType.set(chatId, selectedType);
        await removePreviousButtons();
        return editMessage(chatId, messageId, `💰 You selected ${selectedType} tournament.\nPlease select your preferred amount:`, balanceButtons(selectedType));

      case data.startsWith('balance_'):
        if (!user) return requireRegistration();
        const parts = data.split('_');
        const type = parts[1];
        const amount = Number(parts[2]);
        await removePreviousButtons();
        return editMessage(chatId, messageId, `💳 Choose a payment method for ${amount} Birr:`, paymentMethodButtons(type, amount));

      case data.startsWith('pay_'):
        if (!user) return requireRegistration();
        const [, payType, payAmountStr, method] = data.split('_');
        const payAmount = Number(payAmountStr);
        try {
          const checkoutUrl = await createArifPayPayment(payAmount, user, payType, method);
          await bot.sendMessage(chatId, `💵 Complete your payment here:\n${checkoutUrl}`);
        } catch {
          await bot.sendMessage(chatId, "⚠️ Failed to create payment session. Please try again.");
        }
        break;

      // ----- 1v1 Menu -----
      case data === 'post_1v1':
        if (!user) return requireRegistration();
        await removePreviousButtons();
        return editMessage(chatId, messageId, '🤝 Choose 1v1 Game Type:', oneVsOneMenu);

      case data === 'back_to_post':
        if (!user) return requireRegistration();
        await removePreviousButtons();
        return editMessage(chatId, messageId, '✅ Choose an option:', postRegistrationMenu);

      case data === '1v1_balance':
        if (!user) return requireRegistration('post_1v1');
        await removePreviousButtons();
        return editMessage(chatId, messageId, `💰 Your 1v1 Balance: ${user.oneVsOne_balance || 0} Birr`, [[{ text: '⬅️ Back', callback_data: 'post_1v1' }]]);



        //1v1 withdrawal
        case data === '1v1_withdraw':
  if (!user) return requireRegistration('post_1v1');
  await removePreviousButtons();

  // Ask user for withdrawal amount
  waitingForWithdrawAmount.set(chatId, {});
  return bot.sendMessage(chatId, '💵 Enter the amount you want to withdraw:');

  //telebirr part

  case data === 'withdraw_telebirr':
  if (!user) return requireRegistration('post_1v1');
  await removePreviousButtons();

  const state = waitingForWithdrawPhone.get(chatId);
  if (!state || !state.amount) return bot.sendMessage(chatId, '❌ Please enter withdrawal amount first.');

  // ✅ Set step to expect Telebirr number
  state.method = 'telebirr';
  state.step = 'waitingForTelebirrNumber';
  waitingForWithdrawPhone.set(chatId, state);

  return bot.sendMessage(chatId, '📱 Please enter your Telebirr number for withdrawal:');



      // ----- 1v1 Deposit Flow -----
      case data === '1v1_deposit':
        if (!user) return requireRegistration('post_1v1');
        await removePreviousButtons();
        return editMessage(chatId, messageId, '💳 Choose your payment method:', chapaOrArifButtons);

      case data === 'deposit_chapa':
        if (!user) return requireRegistration('post_1v1');
        await removePreviousButtons();
        waitingForChapaAmount.set(chatId, {});
        return bot.sendMessage(chatId, '💰 Enter the amount you want to deposit via Chapa:');

      case data === 'deposit_arifpay':
        await removePreviousButtons();
        return bot.sendMessage(chatId, '⚠️ ArifPay integration coming soon.');

      // ----- Tournament / Fixtures / Rules -----
      case data === 'post_tournament':
        await removePreviousButtons();
        return editMessage(chatId, messageId, '✨ Main Menu ✨\n\nChoose an option below:', mainMenuButtons(chatId));

      case data === 'fixture':
        if (!user) return requireRegistration('fixture');
        const fixtures = await getUserFixtures(user._id);
        await removePreviousButtons();
        if (!fixtures.length) return editMessage(chatId, messageId, '⚠️ You have no scheduled fixtures yet.', [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]);
        let text = '📅 Your Tournament Fixtures:\n\n';
        fixtures.forEach((f, idx) => {
          text += `${idx + 1}. [${f.tournamentType} | ${f.balance} Birr | Round ${f.round}]\n`;
          text += `${f.matchText}\nTime: ${f.matchTime}\n\n`;
        });
        return editMessage(chatId, messageId, text, [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]);

      case data === 'rules_privacy':
        if (!user) return requireRegistration();
        await removePreviousButtons();
        return editMessage(chatId, messageId, '*🎲 Ethio Dama – Tournament Rules & Regulations*\n\n...', [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]);

      case data === 'back_to_main':
        await removePreviousButtons();
        return editMessage(chatId, messageId, '✨ Main Menu ✨\n\nChoose an option below:', mainMenuButtons(chatId));

      default:
        await removePreviousButtons();
        return bot.answerCallbackQuery(callbackQuery.id, { text: `Button ${data} clicked.` });
    }

  } catch (err) {
    console.error('Callback query error:', err);
    bot.sendMessage(chatId, '⚠️ An error occurred. Please try again.');
  }
});



module.exports = bot;

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const User = require('./models/user');
const Tournament = require('./models/tournament');
const Fixture = require('./models/fixture');
const PendingTournament = require('./models/PendingTournament'); 

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
    { text: 'ℹ️ My Info', callback_data: 'my_info' }
  ],
  [
    { text: '📝 Register Tournament', callback_data: 'register_tournament' },
  ],
  [
    { text: '📅 Fixtures', callback_data: 'fixture' },
    { text: '🤝 Join Group', url: 'https://t.me/EthioDamaTournament' }
  ],
  [
    { text: '📞 Contact Us', callback_data: 'contact_us' },
    { text: '🏆 My Code', callback_data: 'my_code' }
  ],
  [
    { text: '📜 Rules & Privacy', callback_data: 'rules_privacy' },
    { text: '🎮 How to Play', callback_data: 'how_to_play' }
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
    if (existingUser) {
      sendWelcomeImage(chatId);
      return;
    }
    bot.sendMessage(chatId, 'Welcome! Please send me your full name:');
    waitingForName.add(chatId);
  } catch (err) {
    console.error('Error on /start:', err);
    bot.sendMessage(chatId, '⚠️ Something went wrong, please try again.');
  }
});

// ----- Collect Name & Contact -----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  if (waitingForName.has(chatId)) {
    const name = msg.text?.trim();
    if (!name) return bot.sendMessage(chatId, 'Please send a valid name.');
    waitingForName.delete(chatId);
    waitingForContact.set(chatId, { name });
    return bot.sendMessage(chatId, 'Please share your phone number:', {
      reply_markup: { keyboard: [[{ text: 'Share Contact', request_contact: true }]], one_time_keyboard: true, resize_keyboard: true }
    });
  }

  if (waitingForContact.has(chatId) && msg.contact) {
    const { name } = waitingForContact.get(chatId);
    const phone = msg.contact.phone_number;

    try {
      let user = await User.findOne({ telegram_id: telegramId });
      if (!user) {
        user = await User.create({
          telegram_id: telegramId,
          telegram_username: msg.from.username,
          name,
          phone_number: phone,
          balance: 0
        });
        userCache.set(chatId, user);
      }
      waitingForContact.delete(chatId);
      sendWelcomeImage(chatId);
    } catch (err) {
      console.error('Error saving user:', err);
      bot.sendMessage(chatId, '⚠️ Could not save your info. Please try again.');
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

  const balanceButtons = (selectedType) => [
    [{ text: '5 Birr', callback_data: `balance_${selectedType}_5` }],
    [{ text: '100 Birr', callback_data: `balance_${selectedType}_100` }],
    [{ text: '200 Birr', callback_data: `balance_${selectedType}_200` }],
    [{ text: '⬅️ Back', callback_data: 'back_to_type' }]
  ];

 const paymentMethodButtons = (type, amount) => [
  [{ text: '💳 Telebirr', callback_data: `pay_${type}_${amount}_TELEBIRR` }], // <-- changed here
  [{ text: '🏦 CBE Birr', callback_data: `pay_${type}_${amount}_CBE` }],
  [{ text: '📱 MPesa', callback_data: `pay_${type}_${amount}_MPESA` }],
  [{ text: '⬅️ Back', callback_data: `balance_${type}_${amount}` }]
];


  try {
    const user = await getCachedUser(chatId, telegramId);
    const removePreviousButtons = async () => {
      try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }); } catch {}
    };

    switch (true) {
      case data === 'my_info':
        if (!user) return requireRegistration();
        await removePreviousButtons();
        return editMessage(chatId, messageId, `Your Info:\n\nName: ${user.name}\nTelegram: @${user.telegram_username || 'N/A'}\nPhone: ${user.phone_number}`, [[{ text: '⬅️ Back', callback_data: 'back_to_main' }]]);
      
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
        const [ , payType, payAmountStr, method] = data.split('_');
        const payAmount = Number(payAmountStr);
        try {
          const checkoutUrl = await createArifPayPayment(payAmount, user, payType, method);
          await bot.sendMessage(chatId, `💵 Complete your payment here:\n${checkoutUrl}`);
        } catch {
          await bot.sendMessage(chatId, "⚠️ Failed to create payment session. Please try again.");
        }
        break;

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

      case data === 'back_to_type':
        await removePreviousButtons();
        return editMessage(chatId, messageId, '🎯 *Choose Tournament Type* 🎯', tournamentTypeButtons);

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

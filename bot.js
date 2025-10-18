const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const User = require('./models/user');
const Tournament = require('./models/tournament');
const Fixture = require('./models/fixture');
const PendingTournament = require('./models/PendingTournament'); 
const Withdraw = require('./models/withdraw');
const axios = require("axios"); // Only needed for direct B2C execution




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

const { createArifPayPayment, formatPhone } = require('./services/arifpay');

const {
  createWithdrawalSession,
  executeWithdrawal,
  handleWebhook
} = require('./services/withdrawal');




// ----- Waiting states -----
const waitingForName = new Set();
const waitingForContact = new Map();
const waitingForTournamentType = new Map();

//waiting states for withdrawal

const waitingForWithdrawAmount = new Map(); // chatId => {}
const waitingForWithdrawMethod = new Map(); // chatId => { amount }
const waitingForWithdrawPhone = new Map(); // chatId => { amount, method }



const postRegistrationMenu = [
  [
    { text: '🎯 Tournament', callback_data: 'post_tournament' },
    { text: '🤝 1v1 Game', callback_data: 'post_1v1' }
  ],
  [
    { text: '💳 Deposit', callback_data: '1v1_deposit' },
    { text: '🏦 Withdraw', callback_data: '1v1_withdraw' }
  ],
  [
    { text: '💰 Balance', callback_data: '1v1_balance' },
    { text: '📜 Transaction', callback_data: '1v1_transaction' }
  ],
  [
    { text: 'ℹ️ My Info', callback_data: 'my_info' },
    { text: '📞 Contact Us', callback_data: 'contact_us' }
  ],
  [
    { text: '🤝 Join Group', url: 'https://t.me/EthioDamaTournament' }
  ]
];

// Show payment method buttons after entering amount








// ----- User cache -----


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



async function getFreshUser(telegramId) {
  return await User.findOne({ telegram_id: telegramId });
}


// Place near the top of bot.js
const userCache = new Map(); // chatId => { user, lastFetched }

async function getCachedUser(chatId, telegramId, forceRefresh = false) {
  const cached = userCache.get(chatId);
  const now = Date.now();

  // Fetch fresh data every 10 seconds or if forced
  const shouldRefresh =
    forceRefresh ||
    !cached ||
    now - cached.lastFetched > 10 * 1000; // 10 seconds freshness window

  if (shouldRefresh) {
    const user = await User.findOne({ telegram_id: telegramId });
    if (user) {
      userCache.set(chatId, { user, lastFetched: now });
      return user;
    } else {
      userCache.delete(chatId); // remove invalid entry
      return null;
    }
  }

  // Return cached user if still fresh
  return cached.user;
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


//deposite waitings of arif pay
const waitingForDepositAmount = new Map(); // chatId => {}
const waitingForDepositMethod = new Map(); // chatId => { amount }
const waitingForDepositPhone = new Map(); // chatId => { amount, method }


// ----- /start -----
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // ✅ Respond immediately
  bot.sendMessage(chatId, '👋 Hello! Preparing your dashboard...');

  (async () => {
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
      await bot.sendMessage(chatId, 'Welcome! Please send me your full name:');
      waitingForName.add(chatId);

    } catch (err) {
      console.error('Error on /start:', err);
      await bot.sendMessage(chatId, '⚠️ Something went wrong, please try again.');
    }
  })();
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
    if (!name) return bot.sendMessage(chatId, '⚠️ Please send a valid name.');

    waitingForName.delete(chatId);
    waitingForContact.set(chatId, { name });
    console.log(`[Registration] Name collected: ${name}, prompting for contact...`);

    return bot.sendMessage(chatId, '📞 Please share your phone number (e.g., 0927XXXXXXX):', {
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
      phone = formatPhone(phone); // Auto-format to 2519XXXXXXXX
      console.log(`[Registration] Formatted phone: ${phone}`);
    } catch (err) {
      return bot.sendMessage(chatId, `⚠️ Invalid phone number. ${err.message}`);
    }

    try {
      let user = await User.findOne({ telegram_id: telegramId.toString() });
      if (!user) {
        user = await User.create({
          telegram_id: telegramId.toString(),
          telegram_username: msg.from.username || null,
          name,
          phone_number: phone,
          balance: 0,
          oneVsOne_balance: 0
        });
        userCache.set(chatId, { user, lastFetched: Date.now() });
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
  // 3️⃣ ArifPay Deposit Flow
  // -------------------------

  // Step 1: User entered deposit amount
  if (waitingForDepositAmount.has(chatId) && !isNaN(msg.text)) {
    const amount = parseFloat(msg.text);
    waitingForDepositAmount.delete(chatId);
    waitingForDepositMethod.set(chatId, { amount });

    const methodButtons = [
      [{ text: 'Telebirr', callback_data: 'deposit_method_telebirr' }],
      [{ text: 'M-Pesa', callback_data: 'deposit_method_mpesa' }],
      [{ text: 'CBE', callback_data: 'deposit_method_cbe' }],
      [{ text: '⬅️ Cancel', callback_data: 'back_to_post' }]
    ];

    return bot.sendMessage(chatId, `💳 You entered ${amount} Birr. Choose your payment method:`, {
      reply_markup: { inline_keyboard: methodButtons }
    });
  }

  // Step 2: User entered phone number for deposit
  if (waitingForDepositPhone.has(chatId)) {
    const { amount, method } = waitingForDepositPhone.get(chatId);
    let phone = msg.text?.trim();

    try {
      phone = formatPhone(phone); // Auto-format to 2519XXXXXXXX
    } catch (err) {
      return bot.sendMessage(chatId, `⚠️ Invalid phone number. ${err.message}`);
    }

    waitingForDepositPhone.delete(chatId);

    // ✅ Get user from cache or DB
    const user = await getCachedUser(chatId, telegramId, true);
    if (!user) return bot.sendMessage(chatId, '⚠️ User not found. Please register first using /start.');

    try {
      // ✅ Pass telegram_id instead of full user
      const paymentResult = await createArifPayPayment(amount, user.telegram_id.toString(), phone);

      if (paymentResult.success) {
        return bot.sendMessage(
          chatId,
          `✅ Payment request of ${amount} Birr sent to ${phone} via ${method}.\nPlease complete the payment in your mobile wallet.`
        );
      } else {
        return bot.sendMessage(chatId, `⚠️ Failed to send payment request: ${paymentResult.message}`);
      }
    } catch (err) {
      console.error('[ArifPay] Payment error:', err);
      return bot.sendMessage(chatId, '⚠️ Failed to initiate payment. Please try again.');
    }
  }

  //withdrawal steps
// ----- Step 1: User enters withdrawal amount -----
if (waitingForWithdrawAmount.has(chatId) && !isNaN(msg.text)) {
  const amount = parseFloat(msg.text);
  if (amount <= 0) return bot.sendMessage(chatId, '⚠️ Please enter a valid amount greater than 0.');

  waitingForWithdrawAmount.delete(chatId);
  waitingForWithdrawMethod.set(chatId, { amount });

  const methodButtons = [
    [{ text: 'Telebirr', callback_data: 'withdraw_method_telebirr' }],
    // Add other methods here if needed
    [{ text: '⬅️ Cancel', callback_data: 'back_to_post' }]
  ];

  return bot.sendMessage(chatId, `💰 You entered ${amount} Birr. Choose your withdrawal method:`, {
    reply_markup: { inline_keyboard: methodButtons }
  });
}

// ----- Step 2: User enters phone number for withdrawal -----
if (waitingForWithdrawPhone.has(chatId)) {
  const { amount, method } = waitingForWithdrawPhone.get(chatId);
  let phone = msg.text?.trim();

  try {
    phone = formatPhone(phone); // Converts to 2519XXXXXXXX
  } catch (err) {
    return bot.sendMessage(chatId, `⚠️ Invalid phone number. ${err.message}`);
  }

  waitingForWithdrawPhone.delete(chatId);

  // ✅ Fetch user from cache or DB
  const user = await getCachedUser(chatId, telegramId, true);
  if (!user) return bot.sendMessage(chatId, '⚠️ User not found. Please register first using /start.');

  try {
    const methodKey = method.toLowerCase(); // Standardize for schema

    // --- Step 2a: Create withdrawal session ---
    const sessionResult = await createWithdrawalSession(user, amount, phone);

    if (!sessionResult.success) {
      return bot.sendMessage(chatId, `⚠️ Withdrawal failed: ${sessionResult.message}`);
    }

    // --- Step 2b: Execute withdrawal using ArifPay plugin ---
    const execResult = await executeWithdrawal(sessionResult.reference, phone, amount);

    if (execResult.success) {
      return bot.sendMessage(chatId, `✅ Withdrawal of ${amount} Birr sent to ${phone} via ${methodKey}.`);
    } else {
      return bot.sendMessage(chatId, `⚠️ Withdrawal execution failed: ${execResult.message}`);
    }
  } catch (err) {
    console.error('[Withdrawal] Error:', err);
    return bot.sendMessage(chatId, '⚠️ Error processing withdrawal. Please try again later.');
  }
}


});









// ----- Callback Queries -----
bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const data = callbackQuery.data;
  const telegramId = callbackQuery.from.id;

  // ✅ Respond immediately to remove Telegram button "loading"
  bot.answerCallbackQuery(callbackQuery.id).catch(() => {});

  (async () => {
    const requireRegistration = async (backData = 'back_to_main') => {
      await editMessage(chatId, messageId, '❌ Please register first using /start.', [
        [{ text: '⬅️ Back', callback_data: backData }]
      ]);
    };

    const user = await getCachedUser(chatId, telegramId);

    const removePreviousButtons = async () => {
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
      } catch {}
    };

    // ----- Helper buttons -----
    const oneVsOneMenu = [
      [{
        text: '🎮 Play',
        web_app: { url: `${NGROK_URL}/dashboard.html?userId=${chatId}` }
      }],
      [{ text: '💰 Balance', callback_data: '1v1_balance' }],
      [{ text: '⬅️ Back', callback_data: 'back_to_post' }]
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
          const [_, type, amountStr] = data.split('_');
          const amount = Number(amountStr);
          await removePreviousButtons();
          return editMessage(chatId, messageId, `💳 Choose a payment method for ${amount} Birr:`, paymentMethodButtons(type, amount));

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
          if (!user) return requireRegistration();
          const freshUser = await getFreshUser(telegramId);
          await removePreviousButtons();
          return editMessage(
            chatId,
            messageId,
            `💰 Your 1v1 Balance: ${freshUser?.oneVsOne_balance || 0} Birr`,
            [[{ text: '⬅️ Back', callback_data: 'back_to_post' }]]
          );
          case data === '1v1_withdraw':
  if (!user) return requireRegistration();
  await removePreviousButtons();
  waitingForWithdrawAmount.set(chatId, true);
  return bot.sendMessage(chatId, '💰 Please enter the withdrawal amount:');

case data.startsWith('withdraw_method_'):
  if (!user) return requireRegistration();

  const withdrawMethod = data.split('withdraw_method_')[1]; // telebirr / mpesa / etc
  const withdrawData = waitingForWithdrawMethod.get(chatId);
  if (!withdrawData) return bot.sendMessage(chatId, '⚠️ Please enter the amount first.');

  // Move to phone step
  waitingForWithdrawMethod.delete(chatId);
  waitingForWithdrawPhone.set(chatId, { amount: withdrawData.amount, method: withdrawMethod });

  return bot.sendMessage(chatId, '📞 Please enter your phone number for the withdrawal:');





        case data === '1v1_deposit':
          if (!user) return requireRegistration();
          await removePreviousButtons();
          waitingForDepositAmount.set(chatId, true);
          return bot.sendMessage(chatId, '💰 Please enter the deposit amount:');

       case data.startsWith('deposit_method_'):
  if (!user) return requireRegistration();
  
  const method = data.split('deposit_method_')[1]; // telebirr / mpesa / cbe
  const depositData = waitingForDepositMethod.get(chatId);
  if (!depositData) return bot.sendMessage(chatId, '⚠️ Please enter the amount first.');

  // 1️⃣ Remove the buttons immediately
  try {
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
  } catch (err) {
    console.log('Failed to remove buttons:', err);
  }

  // 2️⃣ Move to next step
  waitingForDepositMethod.delete(chatId);
  waitingForDepositPhone.set(chatId, { amount: depositData.amount, method });

  // 3️⃣ Ask for phone number
  return bot.sendMessage(chatId, '📞 Please enter your phone number to receive the payment notification:');

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
  })();
});






module.exports = bot;

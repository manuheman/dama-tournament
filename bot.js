const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const path = require('path');
const User = require('./models/user');
const Tournament = require('./models/tournament');
const Fixture = require('./models/fixture');
const PendingTournament = require('./models/PendingTournament'); 

// ✅ Load from environment
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NGROK_URL = process.env.NGROK_URL; // e.g. https://0834ab366433.ngrok-free.app

if (!TOKEN) {
  throw new Error("❌ TELEGRAM_BOT_TOKEN is not set in environment variables.");
}
if (!NGROK_URL) {
  throw new Error("❌ NGROK_URL is not set. Please add it in your .env file.");
}

// ✅ Build webhook dynamically
const WEBHOOK_URL = `${NGROK_URL}/bot${TOKEN}`;

const bot = new TelegramBot(TOKEN);
bot.setWebHook(WEBHOOK_URL);

console.log('✅ Webhook set to:', WEBHOOK_URL);

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

async function getUserFixtures(userId) {
  // Find all fixtures where the user is player1 or player2 and not disabled
  const fixtures = await Fixture.find({
    disabled: false,
    $or: [{ player1: userId }, { player2: userId }]
  })
  .populate('player1', 'name')
  .populate('player2', 'name')
  .populate('tournament', 'type balance') // fetch tournament info
  .sort({ round: 1, matchTime: 1 }); // order by round then time

  // Format fixtures
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


// ----- Welcome -----
function sendWelcomeImage(chatId) {
  const imagePath = path.join(__dirname, 'IMG.JPG');
  bot.sendPhoto(chatId, imagePath, {
    caption: '🎉 Welcome to the Tournament Bot!',
    reply_markup: { inline_keyboard: mainMenuButtons(chatId) }
  }).catch(console.error);
}

// ----- Tournament buttons -----
const tournamentTypeButtons = [
  [{ text: '🥉 Silver', callback_data: 'type_Silver' }, { text: '🥈 Gold', callback_data: 'type_Gold' }],
  [{ text: '🥇 Platinum', callback_data: 'type_Platinum' }],
  [{ text: '⬅️ Back to Menu', callback_data: 'back_to_main' }]
];

const balanceButtons = [
  { amount: 50, emoji: '💰' },
  { amount: 100, emoji: '💎' },
  { amount: 200, emoji: '👑' }
];

// Max players by type
const maxPlayersByType = {
  Silver: 8,
  Gold: 32,
  Platinum: 64
};

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

// ----- Collect name and contact -----
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

  try {
    const user = await getCachedUser(chatId, telegramId);

    switch (true) {
      case data === 'my_info': {
        if (!user) return requireRegistration();
        return editMessage(chatId, messageId,
          `Your Info:\n\nName: ${user.name}\nTelegram: @${user.telegram_username || 'N/A'}\nPhone: ${user.phone_number}`,
          [[{ text: '⬅️ Back', callback_data: 'back_to_main' }]]
        );
      }

      case data === 'register_tournament':
        return editMessage(chatId, messageId, '🎯 *Choose Tournament Type* 🎯', tournamentTypeButtons);

      case data.startsWith('type_'): {
        if (!user) return requireRegistration();
        const selectedType = data.split('_')[1];
        waitingForTournamentType.set(chatId, selectedType);
        const buttons = balanceButtons.map(b => ([{ text: `${b.emoji} ${b.amount} Birr`, callback_data: `balance_${b.amount}` }]));
        buttons.push([{ text: '⬅️ Back to Types', callback_data: 'back_to_type' }]);
        return editMessage(chatId, messageId, '💵 *Select Your Balance Option*\n\nChoose how much you want to stake:', buttons);
      }

      case data.startsWith('balance_'): {
        if (!user) return requireRegistration();

        const selectedBalance = Number(data.split('_')[1]);
        const selectedType = waitingForTournamentType.get(chatId);
        if (!selectedType) return bot.answerCallbackQuery(callbackQuery.id, { text: 'Select tournament type first.' });

        waitingForTournamentType.delete(chatId);

        // Check if user already registered
        const alreadyRegistered = await Tournament.findOne({
          type: selectedType,
          status: { $in: ['open', 'full'] },
          players: user._id
        });

        if (alreadyRegistered) {
          return editMessage(chatId, messageId,
            `⚠️ You are already registered in a ${selectedType} tournament.\nPlease wait until it is finished.`,
            [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
          );
        }

        const txRef = `tournament_${user._id}_${Date.now()}`;
        const SERVER_URL = process.env.NGROK_URL || process.env.SERVER_URL;
        if (!SERVER_URL) throw new Error('❌ SERVER_URL or NGROK_URL missing in .env');

        try {
          const response = await axios.post('https://api.chapa.co/v1/transaction/initialize', {
            amount: selectedBalance,
            currency: "ETB",
            tx_ref: txRef,
            first_name: user.name, // Removed email
            last_name: '',
            callback_url: `${SERVER_URL}/chapa/callback`,
            return_url: `${SERVER_URL}/chapa/return`
          }, {
            headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` }
          });

          const paymentLink = response.data?.data?.checkout_url;
          if (!paymentLink) throw new Error('Payment link not received from Chapa.');

          // Save pending tournament
          await PendingTournament.create({
            txRef,
            user: user._id,
            type: selectedType,
            balance: selectedBalance,
          });

          return editMessage(chatId, messageId,
            `💳 You selected ${selectedType} tournament with ${selectedBalance} Birr.\n\nClick below to complete your payment:`,
            [[{ text: '💰 Pay Now', url: paymentLink }]]
          );
        } catch (err) {
          console.error('Chapa payment initialization error:', err.response?.data || err.message);
          return editMessage(chatId, messageId,
            '⚠️ Unable to generate payment link. Please try again later.',
            [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
          );
        }
      }

      case data === 'fixture': {
        if (!user) return requireRegistration('fixture');
        const fixtures = await getUserFixtures(user._id);
        if (!fixtures.length) {
          return editMessage(chatId, messageId,
            '⚠️ You have no scheduled fixtures yet.',
            [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
          );
        }

        let text = '📅 Your Tournament Fixtures:\n\n';
        fixtures.forEach((f, idx) => {
          text += `${idx + 1}. [${f.tournamentType} | ${f.balance} Birr | Round ${f.round}]\n`;
          text += `${f.matchText}\nTime: ${f.matchTime}\n`;
        });

        return editMessage(chatId, messageId, text,
          [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
        );
      }

      case data === 'rules_privacy': {
        if (!user) return requireRegistration();
        const rulesText = `*🎲 Ethio Dama – Tournament Rules & Regulations*\n\n...`;
        return editMessage(chatId, messageId, rulesText,
          [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
        );
      }

      case data === 'back_to_main':
        return editMessage(chatId, messageId, '✨ Main Menu ✨\n\nChoose an option below:', mainMenuButtons(chatId));

      case data === 'back_to_type':
        return editMessage(chatId, messageId, '🎯 *Choose Tournament Type* 🎯', tournamentTypeButtons);

      default:
        return bot.answerCallbackQuery(callbackQuery.id, { text: `Button ${data} clicked.` });
    }
  } catch (err) {
    console.error('Callback query error:', err);
    bot.sendMessage(chatId, '⚠️ An error occurred. Please try again.');
  }
});

module.exports = bot;

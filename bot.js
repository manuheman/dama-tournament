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
    { text: 'ℹ️ My team', callback_data: 'team' }
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

// ----- Welcome -----
const fs = require("fs");

function sendWelcomeImage(chatId) {
const imagePath = path.join(__dirname, "IMG.jpg");

const stream = fs.createReadStream(imagePath);

bot.sendPhoto(chatId, stream, {
caption: "🎉 Welcome to the Tournament Bot!",
reply_markup: { inline_keyboard: mainMenuButtons(chatId) }
}).catch(console.error);
}

// ----- Tournament buttons -----
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


// ----- Collect name -----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // If waiting for name
  if (waitingForName.has(chatId)) {
    const name = msg.text.trim();
    if (!name) return bot.sendMessage(chatId, 'Please send a valid name.');

    // Save name in waiting map
    waitingForName.delete(chatId);
    waitingForContact.set(chatId, { name });

    // Ask for phone number
    return bot.sendMessage(chatId, 'Please send your phone number:', {
      reply_markup: {
        keyboard: [[{ text: 'Share Contact', request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }

  // If waiting for contact (text input)
  if (waitingForContact.has(chatId) && msg.contact) {
    const { name } = waitingForContact.get(chatId);
    const phone = msg.contact.phone_number;

    // Save user to DB
    try {
      const existingUser = await User.findOne({ telegram_id: telegramId });
      if (!existingUser) {
        const newUser = await User.create({
          telegram_id: telegramId,
          telegram_username: msg.from.username,
          name,
          phone_number: phone,
          balance: 0
        });
        userCache.set(chatId, newUser);
      }
      waitingForContact.delete(chatId);

      // Send welcome image + main menu
      sendWelcomeImage(chatId);
    } catch (err) {
      console.error('Error saving user:', err);
      bot.sendMessage(chatId, '⚠️ Could not save your info. Please try again.');
    }
  }
});


// ----- Collect name and contact -----


// At the very top of bot.js
// At the very top of bot.js


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
        return editMessage(
          chatId,
          messageId,
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

        const amountMap = { Silver: 50, Gold: 100, Platinum: 200 };
        const selectedAmount = amountMap[selectedType];

        const buttons = [
          [{ text: `✅ Register for ${selectedAmount} Birr`, callback_data: `register_${selectedType}` }],
        ];
        buttons.push([{ text: '⬅️ Back to Types', callback_data: 'back_to_type' }]);

        return editMessage(
          chatId,
          messageId,
          `💵 You selected ${selectedType} tournament.\n\nClick below to confirm your registration:`,
          buttons
        );
      }

      case data.startsWith('register_'): {
        if (!user) return requireRegistration();
        const selectedType = data.split('_')[1];

        const typeDefaults = {
          Silver: { balance: 50, maxPlayers: 8 },
          Gold: { balance: 100, maxPlayers: 32 },
          Platinum: { balance: 200, maxPlayers: 64 },
        };

        const { balance, maxPlayers } = typeDefaults[selectedType];

        // Try to find an open tournament of this type
        let tournament = await Tournament.findOne({
          type: selectedType,
          status: 'open',
        }).populate('players');

        if (tournament) {
          // Prevent duplicate registration
          const alreadyRegistered = tournament.players.some(
            (p) => p._id.toString() === user._id.toString()
          );
          if (alreadyRegistered) {
            return editMessage(
              chatId,
              messageId,
              `⚠️ You are already registered for the ${selectedType} Tournament!\n\nTournament Code: ${tournament.uniqueId}`,
              [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
            );
          }

          tournament.players.push(user._id);

          if (tournament.players.length >= tournament.maxPlayers) {
            tournament.status = 'full';
          }

          await tournament.save();
        } else {
          // Create new tournament with defaults
          tournament = new Tournament({
            type: selectedType,
            balance,
            maxPlayers,
            players: [user._id],
          });
          await tournament.save();
        }

        return editMessage(
          chatId,
          messageId,
          `🎉 You are successfully registered for the ${selectedType} Tournament!\n\n` +
            `💰 Entry: ${tournament.balance} Birr\n👥 Players: ${tournament.players.length}/${tournament.maxPlayers}\n` +
            `🏷️ Tournament Code: ${tournament.uniqueId}`,
          [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
        );
      }

      case data === 'fixture': {
        if (!user) return requireRegistration('fixture');
        const fixtures = await getUserFixtures(user._id);
        if (!fixtures.length) {
          return editMessage(
            chatId,
            messageId,
            '⚠️ You have no scheduled fixtures yet.',
            [[{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }]]
          );
        }

        let text = '📅 Your Tournament Fixtures:\n\n';
        fixtures.forEach((f, idx) => {
          text += `${idx + 1}. [${f.tournamentType} | ${f.balance} Birr | Round ${f.round}]\n`;
          text += `${f.matchText}\nTime: ${f.matchTime}\n\n`;
        });

        return editMessage(chatId, messageId, text, [
          [{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }],
        ]);
      }

      case data === 'rules_privacy': {
        if (!user) return requireRegistration();
        const rulesText = `*🎲 Ethio Dama – Tournament Rules & Regulations*\n\n...`;
        return editMessage(chatId, messageId, rulesText, [
          [{ text: '⬅️ Back to Main Menu', callback_data: 'back_to_main' }],
        ]);
      }

      case data === 'back_to_main':
        return editMessage(
          chatId,
          messageId,
          '✨ Main Menu ✨\n\nChoose an option below:',
          mainMenuButtons(chatId)
        );

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

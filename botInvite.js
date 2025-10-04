const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// ----- Bot Token -----
const TOKEN = "8412728311:AAF25i42Ie6i1Lc9KsTdH-8gbu_pKc0G4NM";
const bot = new TelegramBot(TOKEN, { polling: true });

// ----- Channel info -----
const CHANNEL_LINK = "https://t.me/ethiodama01";
const CHANNEL_USERNAME = "ethiodama01";

// ----- JSON file -----
const DATA_FILE = "users.json";

// Load existing data
let users = {};
if (fs.existsSync(DATA_FILE)) {
    users = JSON.parse(fs.readFileSync(DATA_FILE));
}

// ----- Save JSON -----
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 4));
    console.log("✅ Data saved:", users);
}

// ----- Inline keyboard for main menu -----
const mainInlineKeyboard = [
    [{ text: "📋 My Info", callback_data: "my_info" }],
    [{ text: "👥 Invite Friends", callback_data: "invite_friends" }],
    [{ text: "📊 My Invites", callback_data: "my_invites" }],
    [{ text: "🏆 Leaderboard", callback_data: "leaderboard" }]
];

// ----- Show main menu -----
async function showMainMenu(chatId, forceNew = false) {
    const user = users[chatId];
    if (!user) return;

    if (forceNew || !user.imageMessageId) {
        const sentMessage = await bot.sendPhoto(chatId, "invitation.jpg", {
            caption: `Welcome back, ${user.name}! Choose an option:`,
            reply_markup: { inline_keyboard: mainInlineKeyboard }
        });
        user.imageMessageId = sentMessage.message_id;
        saveData();
    } else {
        await bot.editMessageCaption(
            `Welcome back, ${user.name}! Choose an option:`,
            {
                chat_id: chatId,
                message_id: user.imageMessageId,
                reply_markup: { inline_keyboard: mainInlineKeyboard }
            }
        ).catch(() => {});
    }
}

// ----- Start command -----
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ✅ Store referral but don't count yet
    if (text.includes("ref_")) {
        const refId = text.split("ref_")[1];
        if (refId && refId !== String(chatId)) {
            if (!users[chatId]) users[chatId] = {};
            if (!users[chatId].referredBy) { // prevent overwriting
                users[chatId].referredBy = refId;
                console.log(`👥 User ${chatId} referred by ${refId}`);
            }
            saveData();
        }
    }

    if (users[chatId] && users[chatId].state === "done") {
        return showMainMenu(chatId, true);
    }

    bot.sendMessage(chatId, "Welcome! Please enter your name:");
    if (!users[chatId]) users[chatId] = {};
    users[chatId].state = "awaiting_name"; // ✅ don't reset the object
    saveData();
});

// ----- Commands for inline buttons -----
bot.onText(/\/my_info/, async (msg) => {
    const chatId = msg.chat.id;
    const user = users[chatId];
    if (!user || !user.imageMessageId) return;
    await bot.editMessageCaption(
        `📋 *Your Info:*\n\n👤 Name: ${user.name}\n📞 Phone: ${user.phone}\n💬 Username: @${user.username || "N/A"}\n🆔 ID: ${user.id}`,
        {
            chat_id: chatId,
            message_id: user.imageMessageId,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
        }
    ).catch(() => {});
});

bot.onText(/\/invite_friends/, async (msg) => {
    const chatId = msg.chat.id;
    const user = users[chatId];
    if (!user || !user.imageMessageId || !user.id) return;
    const botInfo = await bot.getMe();
    const inviteLink = `https://t.me/${botInfo.username}?start=ref_${user.id}`;
    await bot.editMessageCaption(
        `👥 Share this link to invite your friends:\n\n${inviteLink}`,
        {
            chat_id: chatId,
            message_id: user.imageMessageId,
            reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
        }
    ).catch(() => {});
});

bot.onText(/\/my_invites/, async (msg) => {
    const chatId = msg.chat.id;
    const user = users[chatId];
    if (!user || !user.imageMessageId) return;
    const count = user.invited ? user.invited.length : 0;
    await bot.editMessageCaption(
        `📊 You have invited *${count}* friends.`,
        {
            chat_id: chatId,
            message_id: user.imageMessageId,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
        }
    ).catch(() => {});
});

bot.onText(/\/leaderboard/, async (msg) => {
    const chatId = msg.chat.id;
    const user = users[chatId];
    if (!user || !user.imageMessageId) return;

    const leaderboard = Object.values(users)
        .filter(u => u.invited && u.invited.length > 0)
        .sort((a, b) => b.invited.length - a.invited.length)
        .slice(0, 10);

    const leaderboardText = leaderboard.length === 0
        ? "🏆 No invitations yet."
        : "🏆 *Leaderboard - Top Inviters*\n\n" +
          leaderboard.map((u, i) =>
              `${i+1}. ${u.username ? "@" + u.username : u.name} (ID: ${u.id}) - ${u.invited.length} invites`
          ).join("\n");

    await bot.editMessageCaption(
        leaderboardText,
        {
            chat_id: chatId,
            message_id: user.imageMessageId,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
        }
    ).catch(() => {});
});



// ----- Handle messages -----
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text && msg.text.startsWith("/start")) return;

    if (!users[chatId]) users[chatId] = { state: "awaiting_name" };
    const user = users[chatId];

    if (user.state === "awaiting_name") {
        user.name = msg.text;
        user.state = "awaiting_phone";
        saveData();

        console.log(`👤 User ${chatId} entered name: ${user.name}`);

        bot.sendMessage(chatId, "Please share your phone number:", {
            reply_markup: {
                keyboard: [[{ text: "Send Phone Number", request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    } else if (user.state === "awaiting_phone") {
        if (msg.contact) {
            user.phone = msg.contact.phone_number;
            user.username = msg.from.username || "";
            user.id = msg.from.id; // store Telegram ID
            user.state = "awaiting_join";
            saveData();

            console.log(`📞 User ${chatId} shared phone: ${user.phone}`);

            // ✅ Save before sending channel link
            bot.sendMessage(chatId, `Join our channel: ${CHANNEL_LINK}`, {
                reply_markup: {
                    inline_keyboard: [[{ text: "✅ I have joined", callback_data: "check_join" }]]
                }
            });
        } else {
            bot.sendMessage(chatId, "Please use the button to send your phone number.");
        }
    }
});

// ----- Handle inline buttons -----
bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    const user = users[chatId];
    if (!user) return;

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});

    if (data === "check_join") {
        try {
            const member = await bot.getChatMember(`@${CHANNEL_USERNAME}`, chatId);
            if (["member", "creator", "administrator"].includes(member.status)) {
                users[chatId].state = "done";

                // ✅ Count referral NOW (after registration + join)
                if (user.referredBy && users[user.referredBy]) {
                    if (!users[user.referredBy].invited) users[user.referredBy].invited = [];
                    if (!users[user.referredBy].invited.includes(chatId)) {
                        users[user.referredBy].invited.push(chatId);
                        bot.sendMessage(
                            users[user.referredBy].id,
                            `🎉 You invited a new friend: ${user.name || "Unknown"}`
                        );
                        console.log(`🎉 ${user.referredBy} invited ${chatId}`);
                    }
                }

                saveData();
                return showMainMenu(chatId, true);
            } else {
                bot.sendMessage(chatId, "❌ You are not registered. Please join the channel first.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ I have joined", callback_data: "check_join" }]]
                    }
                });
            }
        } catch {
            bot.sendMessage(chatId, "❌ You are not registered. Please join the channel first.", {
                reply_markup: {
                    inline_keyboard: [[{ text: "✅ I have joined", callback_data: "check_join" }]]
                }
            });
        }
        return;
    }

    switch (data) {
        case "my_info":
            if (user.imageMessageId) {
                await bot.editMessageCaption(
                    `📋 *Your Info:*\n\n👤 Name: ${user.name}\n📞 Phone: ${user.phone}\n💬 Username: @${user.username || "N/A"}\n🆔 ID: ${user.id}`,
                    {
                        chat_id: chatId,
                        message_id: user.imageMessageId,
                        parse_mode: "Markdown",
                        reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
                    }
                ).catch(() => {});
            }
            break;

        case "invite_friends":
            if (user.id && user.imageMessageId) {
                const botInfo = await bot.getMe();
                const inviteLink = `https://t.me/${botInfo.username}?start=ref_${user.id}`;
                await bot.editMessageCaption(
                    `👥 Share this link to invite your friends:\n\n${inviteLink}`,
                    {
                        chat_id: chatId,
                        message_id: user.imageMessageId,
                        reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
                    }
                ).catch(() => {});
            }
            break;

        case "my_invites":
            if (user.imageMessageId) {
                const count = user.invited ? user.invited.length : 0;
                await bot.editMessageCaption(
                    `📊 You have invited *${count}* friends.`,
                    {
                        chat_id: chatId,
                        message_id: user.imageMessageId,
                        parse_mode: "Markdown",
                        reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
                    }
                ).catch(() => {});
            }
            break;

   case "leaderboard":
    if (user.imageMessageId) {
        const leaderboard = Object.values(users)
            .filter(u => u.invited && u.invited.length > 0)
            .sort((a, b) => b.invited.length - a.invited.length)
            .slice(0, 10);

        const leaderboardText = leaderboard.length === 0
            ? "🏆 No invitations yet."
            : "🏆 *Leaderboard - Top Inviters*\n\n" +
              leaderboard.map((u, i) =>
                  `${i + 1}. ${u.name} - ${u.invited.length} invites`
              ).join("\n");

        await bot.editMessageCaption(
            leaderboardText,
            {
                chat_id: chatId,
                message_id: user.imageMessageId,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: "back_main" }]] }
            }
        ).catch(() => {});
    }
    break;


        case "back_main":
            if (user.imageMessageId) {
                await bot.editMessageCaption(
                    `Welcome back, ${user.name}! Choose an option:`,
                    {
                        chat_id: chatId,
                        message_id: user.imageMessageId,
                        reply_markup: { inline_keyboard: mainInlineKeyboard }
                    }
                ).catch(() => {});
            }
            break;
    }
});


function deleteUser(chatId) {
    chatId = String(chatId); // ensure string key
    if (users[chatId]) {
        delete users[chatId];   // remove user
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 4));
        console.log(`User ${chatId} deleted successfully.`);
        return true;
    } else {
        console.log(`User ${chatId} not found.`);
        return false;
    }
}



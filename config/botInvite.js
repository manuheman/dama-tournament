import json
from telegram import Update, KeyboardButton, ReplyKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, ContextTypes, filters

# ----- Bot Token -----
TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"

# ----- JSON File -----
DATA_FILE = "users.json"

# Load existing data
try:
    with open(DATA_FILE, "r") as f:
        users_data = json.load(f)
except FileNotFoundError:
    users_data = {}

# ----- Start Command -----
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Welcome! Please enter your name:")
    context.user_data['state'] = 'awaiting_name'

# ----- Handle Messages -----
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    state = context.user_data.get('state')
    user_id = str(update.message.from_user.id)
    username = update.message.from_user.username or ""

    if state == 'awaiting_name':
        context.user_data['name'] = update.message.text
        keyboard = [[KeyboardButton("Send Phone Number", request_contact=True)]]
        reply_markup = ReplyKeyboardMarkup(keyboard, one_time_keyboard=True, resize_keyboard=True)
        await update.message.reply_text("Thanks! Now please share your phone number.", reply_markup=reply_markup)
        context.user_data['state'] = 'awaiting_phone'

    elif state == 'awaiting_phone':
        if update.message.contact:
            phone = update.message.contact.phone_number
            name = context.user_data['name']

            # Save data in JSON
            users_data[user_id] = {
                "name": name,
                "phone": phone,
                "username": username
            }
            with open(DATA_FILE, "w") as f:
                json.dump(users_data, f, indent=4)

            await update.message.reply_text(f"Thank you, {name}! Your data has been saved.")
            context.user_data.clear()
        else:
            await update.message.reply_text("Please use the button to share your phone number.")

# ----- Main -----
app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.TEXT | filters.CONTACT, handle_message))

print("Bot is running...")
app.run_polling()


// reminderScheduler.js
const mongoose = require('mongoose');
const Fixture = require('./models/fixture'); // adjust path if needed
const bot = require('./bot'); // your existing bot instance

async function sendReminders() {
  const now = new Date();
  const tenMinLater = new Date(now.getTime() + 10 * 60 * 1000);
  tenMinLater.setSeconds(0, 0); // avoid ms mismatch

  const matches = await Fixture.find({
    matchTime: tenMinLater,
    reminderSent: { $ne: true }
  });

  for (const match of matches) {
    const { player1Id, player2Id, matchTime } = match;

    const readableTime = matchTime.toLocaleString('en-GB', {
      timeZone: 'Africa/Addis_Ababa',
      hour: '2-digit',
      minute: '2-digit'
    });

    const msg = `⚠️ Reminder: Your match will start at ${readableTime} (in 10 minutes). Be ready!`;

    try {
      if (player1Id) await bot.sendMessage(player1Id, msg);
      if (player2Id) await bot.sendMessage(player2Id, msg);

      match.reminderSent = true;
      await match.save();
    } catch (err) {
      console.error('❌ Failed to send reminder:', err.message);
    }
  }
}

// Run every minute
setInterval(() => {
  sendReminders().catch(err => console.error('⛔ Reminder check failed:', err));
}, 60 * 1000);

module.exports = sendReminders;

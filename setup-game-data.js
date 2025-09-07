const mongoose = require("mongoose")
const User = require("./models/user")
const Tournament = require("./models/tournament")
const Fixture = require("./models/fixture")

async function createGameData() {
  try {
    await mongoose.connect("mongodb://localhost:27017/dama_game")
    console.log("✅ Connected to MongoDB")

    // Clear any existing test data
    await User.deleteMany({ telegram_id: { $in: ["player1", "player2"] } })
    await Tournament.deleteMany({ uniqueId: "GAME-TEST" })

    // Create two test players
    const player1 = new User({
      name: "Alice",
      telegram_id: "player1",
      telegram_username: "alice_player",
      phone_number: "+1111111111",
    })

    const player2 = new User({
      name: "Bob",
      telegram_id: "player2",
      telegram_username: "bob_player",
      phone_number: "+2222222222",
    })

    await player1.save()
    await player2.save()
    console.log("✅ Players created: Alice and Bob")

    // Create a tournament
    const tournament = new Tournament({
      type: "Daily",
      balance: 50,
      players: [player1._id, player2._id],
      maxPlayers: 4,
      status: "open",
      uniqueId: "GAME-TEST",
    })

    await tournament.save()
    console.log("✅ Tournament created: GAME-TEST")

    // Helper to get next 2:00 AM
    function getNext2AM() {
      const now = new Date();
      const next2AM = new Date(now);
      next2AM.setHours(2, 0, 0, 0);
      if (now >= next2AM) {
        next2AM.setDate(next2AM.getDate() + 1);
      }
      return next2AM;
    }

    // Create a fixture (match)
    const fixture = new Fixture({
      tournament: tournament._id,
      player1: player1._id,
      player2: player2._id,
      result: "pending",
      status: "pending",
      startTime: getNext2AM(),
    })

    await fixture.save()
    console.log("✅ Match created between Alice and Bob")

    console.log("\n🎮 READY TO PLAY!")
    console.log("Open these URLs in different browser tabs:")
    console.log(`🟢 Player 1 (Alice): http://localhost:3000/user-dashboard.html?userId=player1&tournamentId=GAME-TEST`)
    console.log(`🔴 Player 2 (Bob): http://localhost:3000/user-dashboard.html?userId=player2&tournamentId=GAME-TEST`)
  } catch (error) {
    console.error("❌ Error:", error)
  } finally {
    mongoose.disconnect()
  }
}

createGameData()

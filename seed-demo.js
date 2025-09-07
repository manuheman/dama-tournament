// Seed a demo tournament, users, and fixtures
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/user.js";
import Tournament from "../models/tournament.js";
import Fixture from "../models/fixture.js";

dotenv.config();

const MONGO =
  process.env.MONGO_URL || "mongodb://localhost:27017/my_node_project";

async function run() {
  await mongoose.connect(MONGO);
  console.log("✅ Connected to MongoDB");

  try {
    // Clean previous demo
    await Promise.all([
      User.deleteMany({
        telegram_id: { $in: ["demo_p1", "demo_p2", "demo_p3", "demo_p4"] },
      }),
      Tournament.deleteMany({ uniqueId: "GAME-DEMO" }),
      Fixture.deleteMany({}),
    ]);

    const [p1, p2, p3, p4] = await User.insertMany([
      {
        name: "Abel M.",
        telegram_id: "demo_p1",
        telegram_username: "abel",
        phone_number: "+251900000001",
      },
      {
        name: "Beth Y.",
        telegram_id: "demo_p2",
        telegram_username: "beth",
        phone_number: "+251900000002",
      },
      {
        name: "Chala G.",
        telegram_id: "demo_p3",
        telegram_username: "chala",
        phone_number: "+251900000003",
      },
      {
        name: "Dagi K.",
        telegram_id: "demo_p4",
        telegram_username: "daki",
        phone_number: "+251900000004",
      },
    ]);
    console.log("👥 Users:", p1.name, p2.name, p3.name, p4.name);

    const tournament = await Tournament.create({
      type: "Daily",
      balance: 50,
      players: [p1._id, p2._id, p3._id, p4._id],
      maxPlayers: 4,
      status: "open",
      uniqueId: "GAME-DEMO",
    });

    const fixtures = await Fixture.insertMany([
      {
        tournament: tournament._id,
        player1: p1._id,
        player2: p2._id,
        status: "scheduled",
        result: "pending",
        matchTime: new Date(Date.now() + 10 * 60 * 1000),
      },
      {
        tournament: tournament._id,
        player1: p3._id,
        player2: p4._id,
        status: "scheduled",
        result: "pending",
        matchTime: new Date(Date.now() + 20 * 60 * 1000),
      },
    ]);

    console.log(`🏆 Tournament ${tournament.uniqueId} created`);
    console.log(`⚔️ Fixtures: ${fixtures.length}`);

    console.log("\nOpen dashboards:");
    console.log(
      `- http://localhost:${
        process.env.PORT || 3000
      }/user-dashboard.html?userId=demo_p1&tournamentId=GAME-DEMO`
    );
    console.log(
      `- http://localhost:${
        process.env.PORT || 3000
      }/user-dashboard.html?userId=demo_p2&tournamentId=GAME-DEMO`
    );
  } catch (e) {
    console.error("❌ Seed error:", e);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected MongoDB");
  }
}

run();
